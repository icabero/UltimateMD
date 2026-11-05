//! The `umd://` scheme serves vault files to the webview: images used in notes
//! and `.html` notes. URLs look like `umd://localhost/<vault id>/<path>`.
//!
//! HTML is the sensitive case. Its CSP `sandbox` directive gives each page an
//! opaque origin with no access to the app, even if the frame were to lose its
//! own sandbox attribute, and it cannot reach the network.

use percent_encoding::percent_decode_str;
use tauri::http::{Request, Response, StatusCode, header};
use ultimatemd_core::{Registry, Vault, VaultFs};

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

pub fn handle(request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let path = percent_decode_str(request.uri().path()).decode_utf8_lossy().into_owned();
    let Some((id, rel)) = path.trim_start_matches('/').split_once('/') else {
        return empty(StatusCode::BAD_REQUEST);
    };
    let Ok(registry) = Registry::load() else {
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
