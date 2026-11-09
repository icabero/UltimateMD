//! The `umd://` scheme serves vault files to the webview: images used in notes
//! and `.html` notes. URLs look like `umd://localhost/<vault id>/<path>`.
//!
//! HTML is the sensitive case. Its CSP `sandbox` directive gives each page an
//! opaque origin with no access to the app, even if the frame were to lose its
//! own sandbox attribute, and it cannot reach the network.

use percent_encoding::percent_decode_str;
use tauri::http::{Request, Response, StatusCode, header};
use ultimatemd_core::{Registry, Result, Vault, VaultFs};

const HTML_POLICY: &str = "default-src umd: http://umd.localhost data:; \
    style-src umd: http://umd.localhost data: 'unsafe-inline'; \
    connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'";

fn csp_for_html(vault: &Vault) -> String {
    if vault.allow_scripts {
        format!("sandbox allow-scripts; {HTML_POLICY}; script-src umd: http://umd.localhost data: 'unsafe-inline'")
    } else {
        format!("sandbox; {HTML_POLICY}; script-src 'none'")
    }
}

fn mime(path: &str) -> &'static str {
    let ext = path.rsplit_once('.').map_or("", |(_, e)| e).to_ascii_lowercase();
    match ext.as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "json" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "pdf" => "application/pdf",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "ttf" => "font/ttf",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mp3" => "audio/mpeg",
        "ogg" => "audio/ogg",
        "wav" => "audio/wav",
        _ => "application/octet-stream",
    }
}

fn empty(status: StatusCode) -> Response<Vec<u8>> {
    Response::builder().status(status).body(Vec::new()).expect("static response")
}

/// A loose file may show images beside it, but nothing else from its folder.
fn serve_loose_image(dir: &std::path::Path, rel: &str) -> Response<Vec<u8>> {
    let content_type = mime(rel);
    if !content_type.starts_with("image/") {
        return empty(StatusCode::FORBIDDEN);
    }
    let bytes = VaultFs::new(dir).resolve_file(rel).ok().and_then(|f| std::fs::read(f).ok());
    let Some(bytes) = bytes else {
        return empty(StatusCode::NOT_FOUND);
    };
    Response::builder()
        .header(header::CONTENT_TYPE, content_type)
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(header::CACHE_CONTROL, "no-store")
        .body(bytes)
        .unwrap_or_else(|_| empty(StatusCode::INTERNAL_SERVER_ERROR))
}

pub fn handle(request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    respond(request.uri().path(), Registry::load)
}

/// Answers a request for `uri_path`, with the registry given so tests need not
/// touch the user's own.
fn respond(uri_path: &str, load: impl FnOnce() -> Result<Registry>) -> Response<Vec<u8>> {
    let path = percent_decode_str(uri_path).decode_utf8_lossy().into_owned();
    let Some((id, rel)) = path.trim_start_matches('/').split_once('/') else {
        return empty(StatusCode::BAD_REQUEST);
    };
    if let Some(dir) = crate::loose::dir_of(id) {
        return serve_loose_image(&dir, rel);
    }
    let Ok(registry) = load() else {
        return empty(StatusCode::INTERNAL_SERVER_ERROR);
    };
    let Ok(vault) = registry.find(id) else {
        return empty(StatusCode::NOT_FOUND);
    };
    // Goes through the same path checks as everything else.
    let Ok(file) = VaultFs::new(&vault.path).resolve_file(rel) else {
        return empty(StatusCode::NOT_FOUND);
    };
    let Ok(bytes) = std::fs::read(file) else {
        return empty(StatusCode::NOT_FOUND);
    };

    let content_type = mime(rel);
    let mut response = Response::builder()
        .header(header::CONTENT_TYPE, content_type)
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(header::CACHE_CONTROL, "no-store");
    if content_type.starts_with("text/html") {
        response = response.header(header::CONTENT_SECURITY_POLICY, csp_for_html(vault));
    }
    response.body(bytes).unwrap_or_else(|_| empty(StatusCode::INTERNAL_SERVER_ERROR))
}

#[cfg(test)]
mod tests {
    use super::*;
    use ultimatemd_core::McpAccess;

    fn vault(dir: &std::path::Path, allow_scripts: bool) -> Vault {
        Vault {
            id: "v1".into(),
            name: "Trabajo".into(),
            path: dir.to_path_buf(),
            open: true,
            mcp: McpAccess::Off,
            allow_scripts,
        }
    }

    fn get(path: &str, vault: &Vault) -> Response<Vec<u8>> {
        respond(path, || Ok(Registry { vaults: vec![vault.clone()] }))
    }

    fn header_of(r: &Response<Vec<u8>>, name: header::HeaderName) -> &str {
        r.headers().get(name).map_or("", |v| v.to_str().unwrap())
    }

    fn files() -> tempfile::TempDir {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir(d.path().join("dir")).unwrap();
        std::fs::write(d.path().join("dir/página.html"), "<p>hola</p>").unwrap();
        std::fs::write(d.path().join("img.png"), [0x89, b'P', b'N', b'G']).unwrap();
        d
    }

    #[test]
    fn html_is_sandboxed_without_scripts_or_network() {
        let d = files();
        let r = get("/v1/dir/p%C3%A1gina.html", &vault(d.path(), false));
        assert_eq!(r.status(), StatusCode::OK);
        assert_eq!(r.body(), b"<p>hola</p>");
        assert_eq!(header_of(&r, header::CONTENT_TYPE), "text/html; charset=utf-8");
        assert_eq!(header_of(&r, header::X_CONTENT_TYPE_OPTIONS), "nosniff");
        let csp = header_of(&r, header::CONTENT_SECURITY_POLICY);
        assert!(csp.starts_with("sandbox;"), "{csp}");
        for part in ["script-src 'none'", "connect-src 'none'", "form-action 'none'", "object-src 'none'"] {
            assert!(csp.contains(part), "{part} in {csp}");
        }
    }

    #[test]
    fn scripts_when_allowed_still_run_sandboxed_and_offline() {
        let d = files();
        let r = get("/v1/dir/p%C3%A1gina.html", &vault(d.path(), true));
        let csp = header_of(&r, header::CONTENT_SECURITY_POLICY);
        assert!(csp.starts_with("sandbox allow-scripts;"), "{csp}");
        assert!(!csp.contains("allow-same-origin"), "{csp}");
        assert!(csp.contains("connect-src 'none'"), "{csp}");
    }

    #[test]
    fn other_files_have_no_policy_but_never_sniff() {
        let d = files();
        let r = get("/v1/img.png", &vault(d.path(), false));
        assert_eq!(r.status(), StatusCode::OK);
        assert_eq!(header_of(&r, header::CONTENT_TYPE), "image/png");
        assert_eq!(header_of(&r, header::X_CONTENT_TYPE_OPTIONS), "nosniff");
        assert!(r.headers().get(header::CONTENT_SECURITY_POLICY).is_none());
    }

    #[test]
    fn nothing_outside_the_vault_is_served() {
        let d = files();
        let inner = d.path().join("vault");
        std::fs::create_dir(&inner).unwrap();
        std::fs::write(d.path().join("secreto.txt"), "no").unwrap();
        let v = vault(&inner, false);
        for path in ["/v1/../secreto.txt", "/v1/%2E%2E/secreto.txt", "/v1/..%2Fsecreto.txt", "/v1/..%5Csecreto.txt"] {
            assert_eq!(get(path, &v).status(), StatusCode::NOT_FOUND, "{path}");
        }
        let absolute = format!("/v1/{}", d.path().join("secreto.txt").display());
        assert_eq!(get(&absolute, &v).status(), StatusCode::NOT_FOUND);
    }

    #[test]
    fn unknown_vaults_and_malformed_paths_fail() {
        let d = files();
        let v = vault(d.path(), false);
        assert_eq!(get("/otro/img.png", &v).status(), StatusCode::NOT_FOUND);
        assert_eq!(get("/v1", &v).status(), StatusCode::BAD_REQUEST);
        assert_eq!(get("/v1/no-existe.png", &v).status(), StatusCode::NOT_FOUND);
        let broken = respond("/v1/img.png", || Err(ultimatemd_core::Error::Vault("roto".into())));
        assert_eq!(broken.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }

    #[test]
    fn a_loose_file_shows_only_images_beside_it() {
        let d = files();
        let note = d.path().canonicalize().unwrap().join("suelta.md");
        std::fs::write(&note, "# x").unwrap();
        let id = crate::loose::register(&note);
        let any = vault(d.path(), false);
        assert_eq!(get(&format!("/{id}/img.png"), &any).status(), StatusCode::OK);
        assert_eq!(get(&format!("/{id}/dir/p%C3%A1gina.html"), &any).status(), StatusCode::FORBIDDEN);
        assert_eq!(get(&format!("/{id}/suelta.md"), &any).status(), StatusCode::FORBIDDEN);
        assert_eq!(get(&format!("/{id}/../img.png"), &any).status(), StatusCode::NOT_FOUND);
        crate::loose::remove(&id);
    }

    #[test]
    fn content_types_ignore_case_and_default_to_bytes() {
        assert_eq!(mime("A.PNG"), "image/png");
        assert_eq!(mime("x.HTM"), "text/html; charset=utf-8");
        assert_eq!(mime("sin-extension"), "application/octet-stream");
        assert_eq!(mime("x.exe"), "application/octet-stream");
    }
}
