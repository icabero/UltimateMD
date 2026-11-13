//! Other names a note answers to, as Obsidian has them: `aliases:` (or
//! `alias:`) in its frontmatter, so that `[[Other name]]` leads to it. The
//! emoji a note declares (`icono:` or `icon:`) is read in the same pass.

/// The note's emoji, from `icono:` or `icon:` in its frontmatter: a few characters at most.
pub fn icon(content: &str) -> Option<String> {
    let rest = content.strip_prefix("---\n").or_else(|| content.strip_prefix("---\r\n"))?;
    let block = rest.split("\n---").next().unwrap_or("");
    block.lines().find_map(|line| {
        let (key, value) = line.split_once(':')?;
        if key.starts_with(' ') || !matches!(key.trim().to_ascii_lowercase().as_str(), "icono" | "icon") {
            return None;
        }
        let value = clean(value);
        (!value.is_empty()
            && value.chars().count() <= 16
            && !value.chars().any(|c| c.is_whitespace() || c.is_control()))
        .then_some(value)
    })
}

/// The aliases a note declares, in any of the ways YAML writes a list:
/// `aliases: [A, "B"]`, `aliases: A`, or one `- A` per line below.
pub fn parse(content: &str) -> Vec<String> {
    let Some(rest) = content.strip_prefix("---\n").or_else(|| content.strip_prefix("---\r\n")) else {
        return Vec::new();
    };
    let block = rest.split("\n---").next().unwrap_or("");
    let mut out = Vec::new();
    let mut lines = block.lines().peekable();
    while let Some(line) = lines.next() {
        let Some((key, value)) = line.split_once(':') else { continue };
        if !matches!(key.trim().to_ascii_lowercase().as_str(), "aliases" | "alias") || key.starts_with(' ') {
            continue;
        }
        let value = value.trim();
        if let Some(list) = value.strip_prefix('[').and_then(|v| v.strip_suffix(']')) {
            out.extend(list.split(',').map(clean));
        } else if !value.is_empty() {
            out.push(clean(value));
        } else {
            while let Some(item) = lines.peek().and_then(|l| l.trim_start().strip_prefix("- ")) {
                out.push(clean(item));
                lines.next();
            }
        }
    }
    out.retain(|a| !a.is_empty());
    out
}

/// A note, the other names it answers to and its emoji.
#[derive(Debug, Clone, serde::Serialize)]
pub struct NoteAliases {
    pub path: String,
    pub aliases: Vec<String>,
    pub icon: Option<String>,
}

/// The aliases and emoji of every note, or only of `paths`. Notes with neither are left
/// out, and so are paths that are not notes any more.
pub fn of_vault(vault: &crate::VaultFs, paths: Option<&[String]>) -> crate::Result<Vec<NoteAliases>> {
    let listing = vault.listing()?;
    let wanted: Vec<&String> = match paths {
        Some(paths) => paths.iter().filter(|p| listing.paths().binary_search(p).is_ok()).collect(),
        None => listing.paths().iter().collect(),
    };
    Ok(wanted
        .into_iter()
        .filter_map(|p| listing.read(p).ok())
        .map(|n| NoteAliases { aliases: parse(&n.content), icon: icon(&n.content), path: n.path })
        .filter(|n| !n.aliases.is_empty() || n.icon.is_some())
        .collect())
}

fn clean(value: &str) -> String {
    value.trim().trim_matches(['"', '\'']).trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::{icon, parse};

    #[test]
    fn every_way_of_writing_a_list() {
        assert_eq!(parse("---\naliases: [Portada, \"Home\"]\n---\n# x"), ["Portada", "Home"]);
        assert_eq!(
            parse("---\naliases:\n  - Salida a producción\n  - 'Go live'\nestado: x\n---\n"),
            ["Salida a producción", "Go live"]
        );
        assert_eq!(parse("---\nalias: Uno\n---\n"), ["Uno"]);
        assert_eq!(parse("---\r\naliases: [A]\r\n---\r\n"), ["A"]);
        assert!(parse("# Sin propiedades\naliases: [No]").is_empty());
        assert!(parse("---\naliases: []\ntags:\n  - a\n---\n").is_empty());
        assert!(parse("---\nnotas:\n  aliases: [Anidado]\n---\n").is_empty(), "only at the top level");
    }

    #[test]
    fn the_emoji_of_a_note() {
        assert_eq!(icon("---\nicono: 🧭\n---\n").as_deref(), Some("🧭"));
        assert_eq!(icon("---\nicon: \"📚\"\n---\n").as_deref(), Some("📚"));
        assert_eq!(icon("# x\nicono: 🧭"), None);
        assert_eq!(icon("---\nicono: una frase larga\n---\n"), None);
        assert_eq!(icon("---\nnotas:\n  icono: 🧭\n---\n"), None);
    }
}
