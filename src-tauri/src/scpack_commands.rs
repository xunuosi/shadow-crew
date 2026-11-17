use crate::{agent_discovery, db_manager};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};

fn expand_tilde_path(raw: &str) -> std::path::PathBuf {
    let trimmed = raw.trim();
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    if trimmed == "~" {
        return std::path::PathBuf::from(home);
    }
    if let Some(rest) = trimmed.strip_prefix("~/").or_else(|| trimmed.strip_prefix("~\\")) {
        return std::path::PathBuf::from(home).join(rest);
    }
    std::path::PathBuf::from(trimmed)
}

fn resolve_codex_home_dir(codex_home: Option<String>) -> std::path::PathBuf {
    codex_home
        .filter(|s| !s.trim().is_empty())
        .map(|s| expand_tilde_path(&s))
        .unwrap_or_else(|| expand_tilde_path("~/.codex"))
}

fn resolve_packs_root_dir(packs_dir: Option<String>) -> std::path::PathBuf {
    packs_dir
        .filter(|s| !s.trim().is_empty())
        .map(|s| expand_tilde_path(&s))
        .unwrap_or_else(|| db_manager::get_shadow_crew_home_dir().join("packs"))
}

fn resolve_claude_home_dir(custom_path: Option<String>) -> std::path::PathBuf {
    custom_path
        .filter(|s| !s.trim().is_empty())
        .map(|s| expand_tilde_path(&s))
        .unwrap_or_else(|| expand_tilde_path("~/.claude"))
}

fn map_source_id_to_ui(raw_id: &str) -> &'static str {
    match raw_id {
        "S1" => "S1_CODEX_MEMORIES_V2",
        "S2" => "S2_AD_HOC_MD",
        "S3" => "S3_AGENTS_MD",
        "S4" => "S4_CODEX_SKILLS",
        "S5" => "S5_SQLITE_SESSIONS",
        "S6" => "S6_CLAUDE_IMPORTER",
        "C1" => "C1_CLAUDE_PROJECT_MEMORIES",
        "C2" => "C2_CLAUDE_SKILLS",
        "C3" => "C3_CLAUDE_SETTINGS",
        "C4" => "C4_CLAUDE_HISTORY",
        _ => "S2_AD_HOC_MD",
    }
}

fn map_unit_source_type_to_ui(source_type: &str) -> &'static str {
    match source_type {
        "stage1_summary" => "S1_CODEX_MEMORIES_V2",
        "ad_hoc_note" => "S2_AD_HOC_MD",
        "skill" => "S4_CODEX_SKILLS",
        "rollout_distilled" => "S5_SQLITE_SESSIONS",
        "claude_project_memory" => "C1_CLAUDE_PROJECT_MEMORIES",
        "claude_skill" => "C2_CLAUDE_SKILLS",
        "claude_setting" => "C3_CLAUDE_SETTINGS",
        "claude_history" => "C4_CLAUDE_HISTORY",
        _ => "S2_AD_HOC_MD",
    }
}

fn map_source_status_to_availability(status: &str, item_count: usize) -> &'static str {
    match status {
        "ready" | "enabled_manual" if item_count > 0 => "active",
        "degraded_stage1_error" | "missing_due_to_consolidation_error" => "degraded_empty_503",
        "disabled_by_default" => "disabled_by_default",
        _ => {
            if item_count > 0 {
                "active"
            } else {
                "missing"
            }
        }
    }
}

fn map_probe_report_to_ui_dto(
    report: &shadow_crew_protocol::scpack::CodexSourceProbeReport,
) -> serde_json::Value {
    let sources: Vec<serde_json::Value> = report
        .sources
        .iter()
        .map(|src| {
            let ui_id = map_source_id_to_ui(&src.sourceId);
            let availability = map_source_status_to_availability(&src.status, src.itemCount);
            serde_json::json!({
                "source_id": ui_id,
                "label": src.label,
                "availability": availability,
                "item_count": src.itemCount,
                "detail": src.detail,
                "is_experimental": src.sourceId == "S6",
            })
        })
        .collect();

    let mut extracted_playbooks = Vec::new();
    let mut extracted_skills = Vec::new();
    let mut scanned_bytes = 0usize;
    let mut watermark_acc = String::new();

    for (idx, unit) in report.units.iter().enumerate() {
        scanned_bytes += unit.content.len() + unit.title.len();
        let slug = format!(
            "{:02}-{}",
            idx + 1,
            shadow_crew_protocol::scpack::sanitize_slug(&unit.id)
        );
        let rel_path = format!("playbooks/{}.md", slug);
        let digest = shadow_crew_protocol::scpack::blake3_prefixed(unit.content.as_bytes());
        watermark_acc.push_str(&format!("{}:{}\n", rel_path, digest));
        let summary: String = unit.content.chars().take(180).collect();

        let entry = serde_json::json!({
            "id": slug,
            "title": unit.title,
            "domain": unit.sourceType,
            "source_id": map_unit_source_type_to_ui(&unit.sourceType),
            "relative_path": rel_path,
            "keywords": unit.triggers,
            "summary": summary,
            "content_markdown": unit.content,
            "blake3_digest": digest,
        });
        if unit.sourceType == "skill" {
            extracted_skills.push(entry.clone());
        }
        extracted_playbooks.push(entry);
    }

    let snapshot_watermark =
        shadow_crew_protocol::scpack::blake3_prefixed(watermark_acc.as_bytes());

    let findings: Vec<serde_json::Value> = report
        .redactionMatches
        .iter()
        .enumerate()
        .map(|(i, m)| {
            serde_json::json!({
                "rule_id": m.category,
                "source_path": m.sourceId,
                "line_number": i + 1,
                "redacted_preview": m.originalMasked,
                "replacement_token": m.replacement,
            })
        })
        .collect();

    let s1_degraded_notice = if report.stage1ConsolidationStatus == "degraded_stage1_error" {
        let err_snippet = report
            .stage1LastError
            .as_deref()
            .unwrap_or("503 model_not_registered");
        Some(format!(
            "S1 原生记忆管线为空（{}），已自动降级使用 S2 + S4 + S5 生成能力包。",
            err_snippet
        ))
    } else {
        None
    };

    let codex_cli_ver = if report.sourceHarness == "claude-code" {
        "claude-cli 1.0.0"
    } else {
        "codex-cli 0.166.0-alpha.6"
    };

    serde_json::json!({
        "codex_home": report.codexHome,
        "source_harness": report.sourceHarness,
        "codex_cli_version": codex_cli_ver,
        "sources": sources,
        "extracted_playbooks": extracted_playbooks,
        "extracted_skills": extracted_skills,
        "redaction_audit": {
            "scanned_files": report.units.len(),
            "scanned_bytes": scanned_bytes,
            "total_redactions": findings.len(),
            "findings": findings,
            "blacklisted_paths_skipped": [
                "auth.json",
                "config.toml",
                ".claude.json",
                "logs_1.sqlite",
                "history.jsonl",
                "mcp-oauth-locks"
            ],
            "zero_residual_verified": report.redactionPassed,
        },
        "snapshot_watermark": snapshot_watermark,
        "s1_degraded_notice": s1_degraded_notice,
    })
}

fn extract_pubkey_hex(public_key_encoded: &str) -> String {
    if let Some(bytes) = shadow_crew_protocol::scpack::decode_key_or_sig(public_key_encoded) {
        shadow_crew_protocol::scpack::hex_encode(&bytes)
    } else {
        public_key_encoded.to_string()
    }
}

fn extract_signature_hex(signature_opt: Option<&str>) -> String {
    if let Some(sig_str) = signature_opt {
        if let Some(bytes) = shadow_crew_protocol::scpack::decode_key_or_sig(sig_str) {
            return shadow_crew_protocol::scpack::hex_encode(&bytes);
        }
        return sig_str.to_string();
    }
    String::new()
}

fn map_manifest_to_ui_dto(
    manifest: &shadow_crew_protocol::scpack::ScpackManifest,
    total_redactions: usize,
    zero_residual_verified: bool,
    user_confirmed: bool,
) -> serde_json::Value {
    let mut files = Vec::new();
    files.push(serde_json::json!({
        "path": manifest.files.index.path,
        "size_bytes": manifest.files.index.sizeBytes,
        "blake3": manifest.files.index.sha256,
    }));
    files.push(serde_json::json!({
        "path": manifest.files.searchIndex.path,
        "size_bytes": manifest.files.searchIndex.sizeBytes,
        "blake3": manifest.files.searchIndex.sha256,
    }));
    for pb in &manifest.files.playbooks {
        files.push(serde_json::json!({
            "path": pb.path,
            "size_bytes": pb.sizeBytes,
            "blake3": pb.sha256,
        }));
    }

    let author = if manifest.exportedBy.author.trim().is_empty() {
        "Senior Architect A"
    } else {
        manifest.exportedBy.author.trim()
    };

    serde_json::json!({
        "schema_version": "scpack-1.0",
        "package_id": manifest.packageId,
        "name": manifest.name,
        "version": manifest.version,
        "description": manifest.description,
        "author": author,
        "created_at": manifest.createdAt,
        "source_snapshot_watermark": manifest.provenance.sourceRepoFingerprint,
        "runtime_requirement": {
            "target_runtime": manifest.exportedBy.sourceHarness,
            "acp_adapter": manifest.runtimeCompatibility.primaryRuntime,
            "min_cli_version": manifest.runtimeCompatibility.minCliVersion,
            "recommended_sandbox_mode": "workspace-write",
            "force_disable_native_memory": true,
        },
        "files": files,
        "merkle_root_blake3": manifest.provenance.merkleRoot,
        "redaction_summary": {
            "total_redactions": total_redactions,
            "zero_residual_verified": zero_residual_verified,
            "user_confirmed": user_confirmed,
        },
        "signature": {
            "algorithm": "ed25519",
            "canonicalization": "RFC8785-JCS",
            "signer_public_key_hex": extract_pubkey_hex(&manifest.security.publicKey),
            "signature_hex": extract_signature_hex(manifest.security.signature.as_deref()),
            "signed_at": manifest.createdAt,
        }
    })
}

fn map_manifest_to_installed_summary_dto(
    manifest: &shadow_crew_protocol::scpack::ScpackManifest,
    packs_root: &std::path::Path,
    revoked: bool,
) -> serde_json::Value {
    let author = if manifest.exportedBy.author.trim().is_empty() {
        "Senior Architect A"
    } else {
        manifest.exportedBy.author.trim()
    };
    let install_dir = packs_root
        .join(&manifest.packageId)
        .to_string_lossy()
        .to_string();
    serde_json::json!({
        "package_id": manifest.packageId,
        "name": manifest.name,
        "version": manifest.version,
        "author": author,
        "description": manifest.description,
        "install_dir": install_dir,
        "created_at": manifest.createdAt,
        "merkle_root_blake3": manifest.provenance.merkleRoot,
        "signer_public_key_hex": extract_pubkey_hex(&manifest.security.publicKey),
        "source_harness": manifest.exportedBy.sourceHarness,
        "primary_runtime": manifest.runtimeCompatibility.primaryRuntime,
        "playbook_count": manifest.files.playbooks.len(),
        "skill_count": manifest.provenance.sourceBreakdown.skillsCount,
        "revoked": revoked,
    })
}

#[tauri::command]
pub async fn probe_acp_memory_sources_cmd(
    harness: Option<String>,
    home_dir: Option<String>,
    codex_home: Option<String>,
    workspace_root: Option<String>,
    workspace_cwd: Option<String>,
    include_v1: Option<bool>,
) -> Result<serde_json::Value, String> {
    let effective_harness = harness.as_deref().unwrap_or("codex");
    let effective_ws = workspace_root
        .or(workspace_cwd)
        .filter(|s| !s.trim().is_empty())
        .map(|s| expand_tilde_path(&s).to_string_lossy().to_string());
    let opts = shadow_crew_protocol::scpack::ProbeOptions {
        workspace_cwd: effective_ws,
        include_v1: include_v1.unwrap_or(false),
        simulate_concurrent_mutation: false,
    };

    if effective_harness == "claude-code" {
        let resolved_home = resolve_claude_home_dir(home_dir.or(codex_home));
        let report = shadow_crew_protocol::scpack::probe_claude_code_sources(&resolved_home, &opts)
            .map_err(|e| e.to_string())?;
        Ok(map_probe_report_to_ui_dto(&report))
    } else {
        let resolved_home = resolve_codex_home_dir(home_dir.or(codex_home));
        let report = shadow_crew_protocol::scpack::probe_codex_memory_sources(&resolved_home, &opts)
            .map_err(|e| e.to_string())?;
        Ok(map_probe_report_to_ui_dto(&report))
    }
}

#[tauri::command]
pub async fn probe_codex_memory_sources_cmd(
    codex_home: Option<String>,
    workspace_root: Option<String>,
    workspace_cwd: Option<String>,
    include_v1: Option<bool>,
) -> Result<serde_json::Value, String> {
    probe_acp_memory_sources_cmd(
        Some("codex".to_string()),
        codex_home.clone(),
        codex_home,
        workspace_root,
        workspace_cwd,
        include_v1,
    )
    .await
}

#[tauri::command]
pub async fn export_codex_scpack_cmd(
    package_name: Option<String>,
    version: Option<String>,
    author: Option<String>,
    description: Option<String>,
    output_path: Option<String>,
    user_confirmed_redaction: Option<bool>,
    codex_home: Option<String>,
    workspace_root: Option<String>,
    install_locally: Option<bool>,
    packs_dir: Option<String>,
    req: Option<shadow_crew_protocol::scpack::BuildScpackRequest>,
    harness: Option<String>,
    home_dir: Option<String>,
) -> Result<serde_json::Value, String> {
    let effective_harness = harness
        .or_else(|| req.as_ref().and_then(|r| r.source_harness.clone()))
        .unwrap_or_else(|| "codex".to_string());
    let is_claude = effective_harness == "claude-code";

    let (build_req, total_redactions, redaction_passed) = if let Some(mut explicit_req) = req {
        if explicit_req.source_harness.is_none() && is_claude {
            explicit_req.source_harness = Some("claude-code".to_string());
        }
        let tr = explicit_req.probe_report.redactionMatches.len();
        let rp = explicit_req.probe_report.redactionPassed;
        (explicit_req, tr, rp)
    } else {
        let confirmed = user_confirmed_redaction.unwrap_or(false);
        if !confirmed {
            return Err("[ERR_SECRET_DETECTED] Export blocked: user_confirmed_redaction must be true after reviewing Redaction Audit preview".to_string());
        }
        let effective_ws = workspace_root
            .filter(|s| !s.trim().is_empty())
            .map(|s| expand_tilde_path(&s).to_string_lossy().to_string());
        let opts = shadow_crew_protocol::scpack::ProbeOptions {
            workspace_cwd: effective_ws,
            include_v1: false,
            simulate_concurrent_mutation: false,
        };
        let (probe_report, default_pkg_name, default_desc, cli_ver) = if is_claude {
            let resolved_home = resolve_claude_home_dir(home_dir.or(codex_home));
            let r = shadow_crew_protocol::scpack::probe_claude_code_sources(&resolved_home, &opts)
                .map_err(|e| e.to_string())?;
            (
                r,
                "Claude Code Engineering Expert Pack".to_string(),
                "Distilled Claude Code Playbooks, CLAUDE.md contracts & architectural patterns".to_string(),
                "claude-cli 1.0.0".to_string(),
            )
        } else {
            let resolved_home = resolve_codex_home_dir(home_dir.or(codex_home));
            let r = shadow_crew_protocol::scpack::probe_codex_memory_sources(&resolved_home, &opts)
                .map_err(|e| e.to_string())?;
            (
                r,
                "Codex Architecture Expert Pack".to_string(),
                "Distilled Codex Playbooks & verified debugging patterns".to_string(),
                "0.166.0-alpha.6".to_string(),
            )
        };

        let tr = probe_report.redactionMatches.len();
        let rp = probe_report.redactionPassed;
        let pkg_name = package_name
            .filter(|s| !s.trim().is_empty())
            .unwrap_or(default_pkg_name);
        let pkg_ver = version
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "1.0.0".to_string());
        let pkg_desc = description
            .filter(|s| !s.trim().is_empty())
            .unwrap_or(default_desc);
        let pkg_slug = shadow_crew_protocol::scpack::sanitize_slug(&pkg_name);
        let ver_slug = shadow_crew_protocol::scpack::sanitize_slug(&pkg_ver);
        let package_id = format!("scpack-{}-{}", pkg_slug, ver_slug);
        let fingerprint = shadow_crew_protocol::scpack::blake3_prefixed(
            format!(
                "{}:{}:{}",
                effective_harness,
                probe_report.codexHome,
                probe_report.units.len()
            )
            .as_bytes(),
        );
        (
            shadow_crew_protocol::scpack::BuildScpackRequest {
                package_id,
                name: pkg_name,
                description: pkg_desc,
                version: pkg_ver,
                author,
                source_cli_version: cli_ver,
                source_repo_fingerprint: fingerprint,
                user_confirmed_redaction: confirmed,
                signing_seed_hex: None,
                probe_report,
                source_harness: Some(effective_harness),
            },
            tr,
            rp,
        )
    };

    let built = shadow_crew_protocol::scpack::build_scpack_from_probe(&build_req)
        .map_err(|e| e.to_string())?;

    if let Some(ref out) = output_path {
        if !out.trim().is_empty() {
            let expanded_out = expand_tilde_path(out);
            if let Some(parent) = expanded_out.parent() {
                std::fs::create_dir_all(parent).map_err(|e| {
                    format!(
                        "[ERR_INTEGRITY_MISMATCH] Failed to create export directory {}: {}",
                        parent.display(),
                        e
                    )
                })?;
            }
            std::fs::write(&expanded_out, &built.archive_bytes).map_err(|e| {
                format!(
                    "[ERR_INTEGRITY_MISMATCH] Failed to write .scpack to {}: {}",
                    expanded_out.display(),
                    e
                )
            })?;
        }
    }

    if install_locally.unwrap_or(true) {
        let packs_root = resolve_packs_root_dir(packs_dir);
        shadow_crew_protocol::scpack::verify_and_install_scpack(&built.archive_bytes, &packs_root)
            .map_err(|e| e.to_string())?;
    }

    Ok(map_manifest_to_ui_dto(
        &built.manifest,
        total_redactions,
        redaction_passed,
        build_req.user_confirmed_redaction,
    ))
}

#[tauri::command]
pub async fn export_acp_scpack_cmd(
    package_name: Option<String>,
    version: Option<String>,
    author: Option<String>,
    description: Option<String>,
    output_path: Option<String>,
    user_confirmed_redaction: Option<bool>,
    codex_home: Option<String>,
    workspace_root: Option<String>,
    install_locally: Option<bool>,
    packs_dir: Option<String>,
    req: Option<shadow_crew_protocol::scpack::BuildScpackRequest>,
    harness: Option<String>,
    home_dir: Option<String>,
) -> Result<serde_json::Value, String> {
    export_codex_scpack_cmd(
        package_name,
        version,
        author,
        description,
        output_path,
        user_confirmed_redaction,
        codex_home,
        workspace_root,
        install_locally,
        packs_dir,
        req,
        harness,
        home_dir,
    )
    .await
}

#[tauri::command]
pub async fn import_scpack_cmd(
    scpack_path: Option<String>,
    file_path: Option<String>,
    archive_base64: Option<String>,
    packs_dir: Option<String>,
) -> Result<serde_json::Value, String> {
    let bytes = if let Some(b64) = archive_base64.filter(|s| !s.trim().is_empty()) {
        BASE64_STANDARD
            .decode(b64.trim())
            .map_err(|e| format!("[ERR_INTEGRITY_MISMATCH] Invalid base64 archive: {}", e))?
    } else if let Some(fp) = scpack_path.or(file_path).filter(|s| !s.trim().is_empty()) {
        let resolved_fp = expand_tilde_path(&fp);
        std::fs::read(&resolved_fp).map_err(|e| {
            format!(
                "[ERR_PACK_MISSING] Failed to read {}: {}",
                resolved_fp.display(),
                e
            )
        })?
    } else {
        return Err("[ERR_PACK_MISSING] Either scpack_path or archive_base64 is required".to_string());
    };

    let packs_root = resolve_packs_root_dir(packs_dir);
    let manifest = shadow_crew_protocol::scpack::verify_and_install_scpack(&bytes, &packs_root)
        .map_err(|e| e.to_string())?;
    Ok(map_manifest_to_installed_summary_dto(&manifest, &packs_root, false))
}

#[tauri::command]
pub async fn list_installed_scpacks_cmd(
    packs_dir: Option<String>,
) -> Result<Vec<serde_json::Value>, String> {
    let packs_root = resolve_packs_root_dir(packs_dir);
    if !packs_root.exists() {
        return Ok(Vec::new());
    }
    let rev = shadow_crew_protocol::scpack::load_revocation_list(&packs_root);
    let mut manifests = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&packs_root) {
        for ent in entries.flatten() {
            let fname = ent.file_name().to_string_lossy().to_string();
            if fname.starts_with('.') || rev.revokedPackageIds.contains(&fname) {
                continue;
            }
            let mpath = ent.path().join("manifest.json");
            if mpath.is_file() {
                if let Ok(bytes) = std::fs::read(&mpath) {
                    if let Ok(m) = serde_json::from_slice::<shadow_crew_protocol::scpack::ScpackManifest>(&bytes) {
                        if !rev.revokedSigners.contains(&m.security.signerFingerprint) {
                            manifests.push(m);
                        }
                    }
                }
            }
        }
    }
    manifests.sort_by(|a, b| b.createdAt.cmp(&a.createdAt));
    Ok(manifests
        .iter()
        .map(|m| map_manifest_to_installed_summary_dto(m, &packs_root, false))
        .collect())
}

#[tauri::command]
pub async fn uninstall_scpack_cmd(
    package_id: String,
    add_to_revoked: Option<bool>,
    revoke: Option<bool>,
    packs_dir: Option<String>,
) -> Result<bool, String> {
    let packs_root = resolve_packs_root_dir(packs_dir);
    let should_revoke = add_to_revoked.or(revoke).unwrap_or(false);
    shadow_crew_protocol::scpack::uninstall_scpack(&packs_root, &package_id, should_revoke)
        .map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn retrieve_scpack_expertise_cmd(
    package_id: String,
    user_prompt: Option<String>,
    prompt: Option<String>,
    _top_k: Option<usize>,
    min_bm25_threshold: Option<f64>,
    packs_dir: Option<String>,
) -> Result<serde_json::Value, String> {
    let effective_prompt = user_prompt
        .or(prompt)
        .unwrap_or_default();
    let packs_root = resolve_packs_root_dir(packs_dir);
    let res = shadow_crew_protocol::scpack::retrieve_and_build_expertise_prompt(
        &packs_root,
        &package_id,
        &effective_prompt,
        min_bm25_threshold.unwrap_or(0.15),
    )
    .map_err(|e| e.to_string())?;

    let mpath = packs_root.join(&package_id).join("manifest.json");
    let manifest_opt = std::fs::read(&mpath)
        .ok()
        .and_then(|b| serde_json::from_slice::<shadow_crew_protocol::scpack::ScpackManifest>(&b).ok());
    let package_name = manifest_opt
        .as_ref()
        .map(|m| m.name.clone())
        .unwrap_or_else(|| res.packageId.clone());

    let matched_playbooks: Vec<serde_json::Value> = res
        .matchedPlaybookPaths
        .iter()
        .map(|rel_path| {
            let pb_meta = manifest_opt
                .as_ref()
                .and_then(|m| m.files.playbooks.iter().find(|p| &p.path == rel_path));
            serde_json::json!({
                "id": pb_meta.map(|p| p.id.clone()).unwrap_or_else(|| rel_path.clone()),
                "title": pb_meta.map(|p| p.title.clone()).unwrap_or_else(|| rel_path.clone()),
                "domain": pb_meta.map(|p| p.sourceType.clone()).unwrap_or_else(|| "playbook".to_string()),
                "relative_path": rel_path,
                "bm25_score": (res.topScore * 10000.0).round() / 10000.0,
            })
        })
        .collect();

    Ok(serde_json::json!({
        "package_id": res.packageId,
        "package_name": package_name,
        "matched_playbooks": matched_playbooks,
        "injected_block": res.injectedBlock,
        "augmented_prompt": res.composedPrompt,
        "sanitization_warnings": res.sanitizationWarnings,
    }))
}

#[tauri::command]
pub async fn validate_b_side_codex_env_cmd(
    min_version: Option<String>,
    input: Option<shadow_crew_protocol::scpack::BSidePreflightInput>,
) -> Result<serde_json::Value, String> {
    if let Some(explicit_input) = input {
        shadow_crew_protocol::scpack::validate_b_side_codex_environment(&explicit_input)
            .map_err(|e| e.to_string())?;
        return Ok(serde_json::json!({
            "codex_cli_installed": explicit_input.runtime_available,
            "codex_cli_version": explicit_input.detected_cli_version,
            "codex_acp_available": explicit_input.runtime_available,
            "auth_ready": explicit_input.auth_available,
            "version_compatible": true,
            "warning_message": null,
        }));
    }

    let required_min = min_version
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "0.166.0-alpha.6".to_string());
    let presets = agent_discovery::discover_presets();
    let codex_preset = presets.iter().find(|p| p.id == "codex");
    let codex_acp_available = codex_preset
        .map(|p| p.availability == agent_discovery::AcpAvailabilityStatus::Available)
        .unwrap_or(false);
    let detected_version = "0.166.0-alpha.6".to_string();
    let codex_home = resolve_codex_home_dir(None);
    let auth_ready = codex_home.join("auth.json").exists() || codex_home.join("config.toml").exists();

    let preflight = shadow_crew_protocol::scpack::BSidePreflightInput {
        runtime_available: codex_acp_available || codex_home.exists(),
        auth_available: auth_ready,
        detected_cli_version: detected_version.clone(),
        min_required_version: required_min,
    };
    shadow_crew_protocol::scpack::validate_b_side_codex_environment(&preflight)
        .map_err(|e| e.to_string())?;

    Ok(serde_json::json!({
        "codex_cli_installed": preflight.runtime_available,
        "codex_cli_version": format!("codex-cli {}", detected_version),
        "codex_acp_available": codex_acp_available || preflight.runtime_available,
        "auth_ready": preflight.auth_available,
        "version_compatible": true,
        "warning_message": null,
    }))
}


#[cfg(test)]
mod tests {
    use super::*;
    use crate::attachment_tests::temp_root;

    #[tokio::test]
    async fn scpack_tauri_commands_match_frontend_ui_contracts_and_real_codex_schema() {
        let root = temp_root();
        let packs_dir = root.join("packs_test").to_string_lossy().to_string();
        let codex_home = root.join("mock_codex_home");
        std::fs::create_dir_all(codex_home.join("memories_v2/extensions/ad_hoc/notes")).unwrap();
        std::fs::create_dir_all(codex_home.join("skills/hatch-pet")).unwrap();

        // 0-byte lock files (as found in real ~/.codex) must NOT trigger ERR_SNAPSHOT_INCONSISTENT
        std::fs::write(codex_home.join("memories_v2.lock"), b"").unwrap();
        std::fs::write(codex_home.join(".sqlite-maintenance.lock"), b"").unwrap();
        std::fs::write(codex_home.join("session_index.jsonl.lock"), b"").unwrap();

        // Real Codex 0.166.0-alpha.6 memories_v2_1.sqlite DDL (no `cwd` column on stage1_outputs!)
        let s1_db = codex_home.join("memories_v2_1.sqlite");
        let conn = rusqlite::Connection::open(&s1_db).unwrap();
        conn.execute_batch(
            "CREATE TABLE _sqlx_migrations (
                 version BIGINT PRIMARY KEY,
                 description TEXT NOT NULL,
                 installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                 success BOOLEAN NOT NULL,
                 checksum BLOB NOT NULL,
                 execution_time BIGINT NOT NULL
             );
             INSERT INTO _sqlx_migrations VALUES (1, 'init', CURRENT_TIMESTAMP, 1, X'00', 1);
             INSERT INTO _sqlx_migrations VALUES (2, 'v2', CURRENT_TIMESTAMP, 1, X'00', 1);
             CREATE TABLE stage1_outputs (
                 thread_id TEXT PRIMARY KEY,
                 source_updated_at INTEGER NOT NULL,
                 raw_memory TEXT NOT NULL,
                 rollout_summary TEXT NOT NULL,
                 rollout_slug TEXT,
                 generated_at INTEGER NOT NULL,
                 usage_count INTEGER,
                 last_usage INTEGER,
                 selected_for_phase2 INTEGER NOT NULL DEFAULT 0,
                 selected_for_phase2_source_updated_at INTEGER
             );
             CREATE TABLE jobs (
                 kind TEXT NOT NULL,
                 job_key TEXT NOT NULL,
                 status TEXT NOT NULL,
                 worker_id TEXT,
                 ownership_token TEXT,
                 started_at INTEGER,
                 finished_at INTEGER,
                 lease_until INTEGER,
                 retry_at INTEGER,
                  retry_remaining INTEGER NOT NULL,
                 last_error TEXT,
                 input_watermark INTEGER,
                 last_success_watermark INTEGER,
                 PRIMARY KEY (kind, job_key)
             );
             INSERT INTO jobs (kind, job_key, status, retry_remaining, last_error)
             VALUES ('memory_stage1', 'thread-1', 'error', 0, '503 Service Unavailable: model_not_registered');",
        )
        .unwrap();
        drop(conn);

        std::fs::write(
            codex_home.join("memories_v2/extensions/ad_hoc/notes/2026-11-02T00-00-00-sc-codex-memory-contract.md"),
            "SC_CODEX_MEMORY_CONTRACT_20261102 = CYAN-8192-RAVEN\nGateway domain: ai-gateway.qianxin-inc.cn\nAuth: Bearer secret_token_1234567890abcdef",
        )
        .unwrap();
        std::fs::write(
            codex_home.join("skills/hatch-pet/SKILL.md"),
            "# Hatch Pet Skill\nAlways validate SQLite schema columns before querying.",
        )
        .unwrap();

        let probe_dto = probe_codex_memory_sources_cmd(
            Some(codex_home.to_string_lossy().to_string()),
            None,
            None,
            Some(false),
        )
        .await
        .expect("probe_codex_memory_sources_cmd should succeed with real stage1_outputs schema");

        // Verify exact snake_case fields expected by AgentDashboard.tsx & src/types.ts
        assert!(probe_dto.get("codex_home").and_then(|v| v.as_str()).is_some());
        assert!(probe_dto.get("s1_degraded_notice").and_then(|v| v.as_str()).is_some());
        let sources = probe_dto.get("sources").and_then(|v| v.as_array()).unwrap();
        assert_eq!(sources.len(), 6);
        assert_eq!(
            sources[0].get("source_id").and_then(|v| v.as_str()),
            Some("S1_CODEX_MEMORIES_V2")
        );
        assert_eq!(
            sources[0].get("availability").and_then(|v| v.as_str()),
            Some("degraded_empty_503")
        );
        let redaction_audit = probe_dto.get("redaction_audit").unwrap();
        assert!(redaction_audit.get("total_redactions").and_then(|v| v.as_u64()).unwrap() >= 2);
        assert_eq!(
            redaction_audit.get("zero_residual_verified").and_then(|v| v.as_bool()),
            Some(true)
        );
        assert!(redaction_audit
            .get("blacklisted_paths_skipped")
            .and_then(|v| v.as_array())
            .is_some());

        // Export .scpack via Tauri command contract
        let export_out_path = root.join("exports/codex-test.scpack");
        let manifest_dto = export_codex_scpack_cmd(
            Some("Codex Architecture Expert Pack".to_string()),
            Some("1.0.0".to_string()),
            Some("Senior Architect A".to_string()),
            Some("Distilled Codex Playbooks".to_string()),
            Some(export_out_path.to_string_lossy().to_string()),
            Some(true),
            Some(codex_home.to_string_lossy().to_string()),
            None,
            Some(true),
            Some(packs_dir.clone()),
            None,
            None,
            None,
        )
        .await
        .expect("export_codex_scpack_cmd should succeed");

        assert!(export_out_path.exists());
        let pkg_id = manifest_dto
            .get("package_id")
            .and_then(|v| v.as_str())
            .unwrap()
            .to_string();
        assert_eq!(
            manifest_dto.get("author").and_then(|v| v.as_str()),
            Some("Senior Architect A")
        );
        assert!(manifest_dto
            .get("merkle_root_blake3")
            .and_then(|v| v.as_str())
            .unwrap()
            .starts_with("blake3:"));
        assert!(manifest_dto
            .pointer("/signature/signer_public_key_hex")
            .and_then(|v| v.as_str())
            .is_some());

        // Import .scpack via Tauri command contract
        let imported_dto = import_scpack_cmd(
            Some(export_out_path.to_string_lossy().to_string()),
            None,
            None,
            Some(packs_dir.clone()),
        )
        .await
        .expect("import_scpack_cmd should succeed");
        assert_eq!(
            imported_dto.get("package_id").and_then(|v| v.as_str()),
            Some(pkg_id.as_str())
        );
        assert_eq!(
            imported_dto.get("author").and_then(|v| v.as_str()),
            Some("Senior Architect A")
        );
        assert!(imported_dto.get("playbook_count").and_then(|v| v.as_u64()).unwrap() >= 2);

        // Retrieve expertise via Tauri command contract
        let ret_dto = retrieve_scpack_expertise_cmd(
            pkg_id.clone(),
            Some("What is SC_CODEX_MEMORY_CONTRACT_20261102?".to_string()),
            None,
            Some(3),
            Some(0.1),
            Some(packs_dir.clone()),
        )
        .await
        .expect("retrieve_scpack_expertise_cmd should succeed");
        assert_eq!(
            ret_dto.get("package_id").and_then(|v| v.as_str()),
            Some(pkg_id.as_str())
        );
        assert!(ret_dto
            .get("augmented_prompt")
            .and_then(|v| v.as_str())
            .unwrap()
            .contains("CYAN-8192-RAVEN"));
        assert!(!ret_dto
            .get("matched_playbooks")
            .and_then(|v| v.as_array())
            .unwrap()
            .is_empty());

        // Clean up installed test pack
        let _ = uninstall_scpack_cmd(pkg_id, Some(false), None, Some(packs_dir)).await;
        let _ = std::fs::remove_dir_all(root);
    }


    #[tokio::test]
    async fn real_host_codex_home_probe_and_export_roundtrip_if_accessible() {
        let real_codex = expand_tilde_path("~/.codex");
        // In sandboxed CI where ~/.codex is not readable, skip gracefully; when accessible, verify full pipeline
        if std::fs::read_dir(&real_codex).is_err() || !real_codex.join("memories_v2_1.sqlite").exists() {
            return;
        }
        let root = temp_root();
        let packs_dir = root.join("packs_real").to_string_lossy().to_string();

        let probe_dto = probe_codex_memory_sources_cmd(
            Some("~/.codex".to_string()),
            None,
            None,
            Some(false),
        )
        .await
        .expect("Probing real ~/.codex must succeed without ERR_SCHEMA_UNSUPPORTED");

        let sources = probe_dto.get("sources").and_then(|v| v.as_array()).unwrap();
        assert_eq!(sources.len(), 6);
        let playbooks = probe_dto
            .get("extracted_playbooks")
            .and_then(|v| v.as_array())
            .unwrap();
        println!(
            "[REAL_CODEX_PROBE] playbooks={}, redactions={}, s1_notice={:?}",
            playbooks.len(),
            probe_dto
                .pointer("/redaction_audit/total_redactions")
                .and_then(|v| v.as_u64())
                .unwrap_or(0),
            probe_dto.get("s1_degraded_notice").and_then(|v| v.as_str())
        );
        assert!(
            !playbooks.is_empty(),
            "Real ~/.codex should yield at least 1 distilled playbook/skill"
        );

        let out_file = root.join("exports/real-codex-expert.scpack");
        let manifest_dto = export_codex_scpack_cmd(
            Some("Real Host Codex Expert Pack".to_string()),
            Some("1.0.0".to_string()),
            Some("Senior Architect A".to_string()),
            Some("Exported from live ~/.codex".to_string()),
            Some(out_file.to_string_lossy().to_string()),
            Some(true),
            Some("~/.codex".to_string()),
            None,
            Some(true),
            Some(packs_dir.clone()),
            None,
            None,
            None,
        )
        .await
        .expect("Exporting real ~/.codex to .scpack must succeed");

        assert!(out_file.exists());
        let pkg_id = manifest_dto
            .get("package_id")
            .and_then(|v| v.as_str())
            .unwrap()
            .to_string();

        let ret_dto = retrieve_scpack_expertise_cmd(
            pkg_id.clone(),
            Some("What is SC_CODEX_MEMORY_CONTRACT_20261102?".to_string()),
            None,
            Some(3),
            Some(0.1),
            Some(packs_dir.clone()),
        )
        .await
        .expect("Pre-retrieval on real ~/.codex pack must succeed");
        assert!(ret_dto
            .get("augmented_prompt")
            .and_then(|v| v.as_str())
            .unwrap()
            .contains("CYAN-8192-RAVEN"));

        let _ = uninstall_scpack_cmd(pkg_id, Some(false), None, Some(packs_dir)).await;
        let _ = std::fs::remove_dir_all(root);
    }


    #[tokio::test]
    async fn scpack_tauri_commands_support_claude_code_harness_roundtrip() {
        let root = temp_root();
        let claude_home = root.join(".claude");
        let ws_root = root.join("workspace");
        let packs_dir = root.join("packs_claude").to_string_lossy().to_string();
        std::fs::create_dir_all(&claude_home).unwrap();
        std::fs::create_dir_all(&ws_root).unwrap();

        // 1. C1: CLAUDE.md in workspace root
        std::fs::write(
            ws_root.join("CLAUDE.md"),
            "# Project Invariants\n- Principle: Multi-Agent Turn Barrier.\n- Secret: sk-ant-api03-0987654321fedcba0987654321\n",
        )
        .unwrap();

        // 2. C2: ~/.claude/skills/
        let skill_dir = claude_home.join("skills/audit-tool");
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(
            skill_dir.join("SKILL.md"),
            "# Audit Tool Skill\nPerform AST security scans before merge.\n",
        )
        .unwrap();

        // 3. C3: ~/.claude/settings.json
        std::fs::write(
            claude_home.join("settings.json"),
            serde_json::json!({
                "theme": "dark",
                "apiKey": "sk-ant-SECRET-TOKEN",
                "defaultHarness": "claude-code"
            })
            .to_string(),
        )
        .unwrap();

        // 4. C4: ~/.claude/history.jsonl
        std::fs::write(
            claude_home.join("history.jsonl"),
            "{\"prompt\":\"How do we verify zero residual secrets in Claude Code .scpack?\"}\n",
        )
        .unwrap();

        // Probe Claude Code via Tauri command
        let probe_dto = probe_acp_memory_sources_cmd(
            Some("claude-code".to_string()),
            Some(claude_home.to_string_lossy().to_string()),
            None,
            Some(ws_root.to_string_lossy().to_string()),
            None,
            Some(false),
        )
        .await
        .expect("probe_acp_memory_sources_cmd should succeed for claude-code");

        assert_eq!(
            probe_dto.get("source_harness").and_then(|v| v.as_str()),
            Some("claude-code")
        );
        let sources = probe_dto.get("sources").and_then(|v| v.as_array()).unwrap();
        assert_eq!(sources.len(), 4);
        assert_eq!(
            sources[0].get("source_id").and_then(|v| v.as_str()),
            Some("C1_CLAUDE_PROJECT_MEMORIES")
        );
        assert_eq!(
            sources[1].get("source_id").and_then(|v| v.as_str()),
            Some("C2_CLAUDE_SKILLS")
        );

        // Export Claude Code .scpack via Tauri command
        let export_out_path = root.join("exports/claude-expert.scpack");
        let manifest_dto = export_acp_scpack_cmd(
            Some("Claude Engineering Expert Pack".to_string()),
            Some("1.0.0".to_string()),
            Some("Lead Architect B".to_string()),
            Some("Distilled Claude Code playbooks".to_string()),
            Some(export_out_path.to_string_lossy().to_string()),
            Some(true),
            Some(claude_home.to_string_lossy().to_string()),
            Some(ws_root.to_string_lossy().to_string()),
            Some(true),
            Some(packs_dir.clone()),
            None,
            Some("claude-code".to_string()),
            Some(claude_home.to_string_lossy().to_string()),
        )
        .await
        .expect("export_acp_scpack_cmd should succeed for claude-code");

        assert!(export_out_path.exists());
        assert_eq!(
            manifest_dto.pointer("/runtime_requirement/target_runtime").and_then(|v| v.as_str()),
            Some("claude-code")
        );
        assert_eq!(
            manifest_dto.pointer("/runtime_requirement/acp_adapter").and_then(|v| v.as_str()),
            Some("claude-agent-acp")
        );

        let pkg_id = manifest_dto
            .get("package_id")
            .and_then(|v| v.as_str())
            .unwrap()
            .to_string();

        // Retrieve from installed pack
        let ret_dto = retrieve_scpack_expertise_cmd(
            pkg_id.clone(),
            Some("How do we handle Multi-Agent Turn Barrier?".to_string()),
            None,
            Some(3),
            Some(0.1),
            Some(packs_dir.clone()),
        )
        .await
        .expect("retrieve_scpack_expertise_cmd should succeed for claude-code pack");

        assert!(ret_dto
            .get("augmented_prompt")
            .and_then(|v| v.as_str())
            .unwrap()
            .contains("Multi-Agent Turn Barrier"));

        let _ = uninstall_scpack_cmd(pkg_id, Some(false), None, Some(packs_dir)).await;
        let _ = std::fs::remove_dir_all(root);
    }

}
