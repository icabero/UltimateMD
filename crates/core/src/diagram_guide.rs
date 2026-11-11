//! A vault's guide for drawing diagrams, in `.ultimatemd/diagramas.md`: free
//! Markdown, like a CLAUDE.md, that an AI reads before drawing so that every
//! diagram in the vault looks alike. A note adds to it with `diagramas:` in its
//! frontmatter, either a short text or a `[[link]]` to a note that is a guide.

use crate::docx::split_frontmatter;
use crate::files::atomic_write;
use crate::vault_themes::FOLDER;
use crate::{Error, Result, VaultFs};
use serde::Serialize;
use std::path::{Path, PathBuf};

const FILE: &str = "diagramas.md";
/// A guide is instructions, not a document.
pub const MAX_SIZE: usize = 64 * 1024;

fn file(root: &Path) -> PathBuf {
    root.join(FOLDER).join(FILE)
}

/// The vault's guide, if it has one.
pub fn load(root: &Path) -> Result<Option<String>> {
    match std::fs::read(file(root)) {
        Ok(bytes) if bytes.len() > MAX_SIZE => Err(Error::Vault("the diagram guide is too large".into())),
        Ok(bytes) => Ok(Some(String::from_utf8_lossy(&bytes).replace("\r\n", "\n"))),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// Saves the guide; an empty one removes it.
pub fn save(root: &Path, text: &str) -> Result<()> {
    let path = file(root);
    if text.trim().is_empty() {
        return match std::fs::remove_file(&path) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.into()),
            _ => Ok(()),
        };
    }
    if text.len() > MAX_SIZE {
        return Err(Error::Vault("the diagram guide is too large".into()));
    }
    std::fs::create_dir_all(path.parent().unwrap())?;
    atomic_write(&path, text.as_bytes())
}

/// Everything that says how a note's diagrams should look.
#[derive(Debug, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Guide {
    /// The vault's guide.
    pub vault: Option<String>,
    /// What the note adds to it.
    pub note: Option<String>,
    /// The note that `diagramas:` links to, when it is a link.
    pub note_source: Option<String>,
    /// The theme the app draws Mermaid and D2 diagrams with: the note's
    /// `tema-diagramas`, or the vault's, or none for the note's own theme.
    pub diagram_theme: Option<String>,
}

/// The guide for a note, or for the whole vault without one.
pub fn for_note(vault: &VaultFs, note: Option<&str>) -> Result<Guide> {
    let mut guide = Guide { vault: load(vault.root())?, ..Guide::default() };
    guide.diagram_theme = crate::vault_themes::load(vault.root()).ok().and_then(|t| t.default_diagram_theme);
    let Some(path) = note else { return Ok(guide) };
    let content = vault.read(path)?.content;
    let meta = split_frontmatter(&content).0;
    if let Some(theme) = meta.get("tema-diagramas").filter(|t| !t.is_empty()) {
        guide.diagram_theme = Some(theme.clone());
    }
    let Some(extra) = meta.get("diagramas").map(|v| v.trim()).filter(|v| !v.is_empty()) else { return Ok(guide) };
    let linked =
        extra.strip_prefix("[[").and_then(|l| l.strip_suffix("]]")).map(|l| l.split(['|', '#']).next().unwrap_or(l));
    match linked {
        Some(name) => {
            let notes = vault.notes()?;
            let target = crate::links::resolve(name.trim(), path, &notes)
                .ok_or_else(|| Error::Vault(format!("the diagram guide [[{name}]] does not exist")))?;
            let text = vault.read(target)?.content;
            guide.note = Some(split_frontmatter(&text).1.trim().to_string());
            guide.note_source = Some(target.clone());
        }
        None => guide.note = Some(extra.to_string()),
    }
    Ok(guide)
}

/// Where diagrams drawn outside the app go, as pasted images do by default.
pub const IMAGE_FOLDER: &str = "adjuntos";
/// The largest PNG accepted, in bytes.
pub const MAX_PNG: usize = 10 * 1024 * 1024;
/// Marks, in a comment no one sees, a picture that an AI drew.
pub const MARK: &str = "diagrama de IA";

/// A diagram drawn outside the app.
pub enum Image<'a> {
    Svg(&'a str),
    Png(&'a [u8]),
}

/// Saves a diagram in the vault, without replacing anything, and returns its
/// path and the Markdown that shows it from `note`.
pub fn add_image(vault: &VaultFs, note: &str, name: &str, image: Image, alt: &str) -> Result<(String, String)> {
    let (bytes, ext) = match image {
        Image::Svg(svg) => (crate::svg::clean(svg)?.into_bytes(), "svg"),
        Image::Png(png) if png.len() > MAX_PNG => return Err(Error::Vault("the PNG is too large".into())),
        Image::Png(png) if !png.starts_with(b"\x89PNG\r\n\x1a\n") => return Err(Error::Vault("not a PNG".into())),
        Image::Png(png) => (png.to_vec(), "png"),
    };
    let stem = name.trim().trim_end_matches(".svg").trim_end_matches(".png");
    let stem = if stem.is_empty() { "diagrama" } else { stem };
    let saved = vault.save_image(IMAGE_FOLDER, &format!("{stem}.{ext}"), &bytes)?;
    let dir = note.rsplit_once('/').map_or("", |(d, _)| d);
    let link = crate::links::relative(dir, &saved).replace(' ', "%20");
    // One line, with nothing that would close the image or the comment.
    let alt: String = alt.chars().map(|c| if matches!(c, '[' | ']' | '%') { ' ' } else { c }).collect();
    let alt = alt.split_whitespace().collect::<Vec<_>>().join(" ");
    Ok((saved, format!("![{alt}]({link})\n%%{MARK}: {alt}%%\n")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::WriteMode;

    #[test]
    fn a_vault_guide_is_saved_loaded_and_removed() {
        let d = tempfile::tempdir().unwrap();
        assert_eq!(load(d.path()).unwrap(), None);
        save(d.path(), "# Estilo\n\nCajas redondeadas.\n").unwrap();
        assert!(d.path().join(".ultimatemd/diagramas.md").is_file());
        assert_eq!(load(d.path()).unwrap().as_deref(), Some("# Estilo\n\nCajas redondeadas.\n"));
        save(d.path(), "  \n").unwrap();
        assert_eq!(load(d.path()).unwrap(), None);
        assert!(save(d.path(), &"x".repeat(MAX_SIZE + 1)).is_err());
    }

    #[test]
    fn a_note_adds_text_or_a_linked_guide() {
        let d = tempfile::tempdir().unwrap();
        let v = VaultFs::new(d.path());
        save(d.path(), "Paleta azul.").unwrap();
        v.write("a.md", "---\ndiagramas: Sin sombras\ntema-diagramas: sepia\n---\n# A\n", WriteMode::Create).unwrap();
        v.write("b.md", "---\ndiagramas: \"[[Guías/Red]]\"\n---\n# B\n", WriteMode::Create).unwrap();
        v.write("Guías/Red.md", "---\ntags: [guia]\n---\nNodos como nubes.\n", WriteMode::Create).unwrap();
        v.write("c.md", "---\ndiagramas: \"[[Nada]]\"\n---\n", WriteMode::Create).unwrap();
        v.write("d.md", "# Sin nada\n", WriteMode::Create).unwrap();

        let a = for_note(&v, Some("a.md")).unwrap();
        assert_eq!(
            (a.vault.as_deref(), a.note.as_deref(), a.diagram_theme.as_deref()),
            (Some("Paleta azul."), Some("Sin sombras"), Some("sepia"))
        );
        let b = for_note(&v, Some("b.md")).unwrap();
        assert_eq!((b.note.as_deref(), b.note_source.as_deref()), (Some("Nodos como nubes."), Some("Guías/Red.md")));
        assert!(for_note(&v, Some("c.md")).is_err(), "a guide that is not there is said");
        assert_eq!(for_note(&v, Some("d.md")).unwrap().note, None);
        assert_eq!(for_note(&v, None).unwrap().vault.as_deref(), Some("Paleta azul."));
    }

    #[test]
    fn a_drawn_diagram_is_saved_clean_and_linked_from_the_note() {
        let d = tempfile::tempdir().unwrap();
        let v = VaultFs::new(d.path());
        let svg = r#"<svg viewBox="0 0 1 1"><script>x()</script><rect width="1" height="1"/></svg>"#;
        let (path, md) =
            add_image(&v, "Proyectos/Web/Plan.md", "Flujo de pago", Image::Svg(svg), "Flujo [de] pago").unwrap();
        assert_eq!(path, "adjuntos/Flujo de pago.svg");
        assert_eq!(md, "![Flujo de pago](../../adjuntos/Flujo%20de%20pago.svg)\n%%diagrama de IA: Flujo de pago%%\n");
        let saved = std::fs::read_to_string(d.path().join(&path)).unwrap();
        assert!(saved.contains("<rect") && !saved.contains("script"));
        let (again, _) = add_image(&v, "x.md", "Flujo de pago.svg", Image::Svg(svg), "b").unwrap();
        assert_eq!(again, "adjuntos/Flujo de pago-2.svg", "nothing is replaced");
        let png = [b"\x89PNG\r\n\x1a\n".as_slice(), b"datos"].concat();
        assert_eq!(add_image(&v, "x.md", "", Image::Png(&png), "c").unwrap().0, "adjuntos/diagrama.png");
        assert!(add_image(&v, "x.md", "f", Image::Png(b"GIF89a"), "c").is_err());
        assert!(add_image(&v, "x.md", "f", Image::Svg("<html/>"), "c").is_err());
        assert!(add_image(&v, "x.md", "../fuera", Image::Svg(svg), "c").is_err());
    }
}
