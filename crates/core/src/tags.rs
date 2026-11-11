//! Tags of a note: `#etiqueta` in the text and `tags:` (or `etiquetas:`) in
//! its properties, as Obsidian writes them. Code blocks, inline code and
//! headings do not count, nor do links to headings such as `[[nota#parte]]`.

use crate::search::fold;

const PROPERTY_KEYS: &[&str] = &["tags", "tag", "etiquetas", "etiqueta"];

/// A character that can be part of a tag name. `/` makes nested tags.
fn tag_char(c: char) -> bool {
    c.is_alphanumeric() || matches!(c, '_' | '-' | '/')
}

/// The properties block at the top, if the note has one, and where the text after it starts.
fn frontmatter(content: &str) -> (Option<&str>, usize) {
    let Some(rest) = content.strip_prefix("---\n").or_else(|| content.strip_prefix("---\r\n")) else {
        return (None, 0);
    };
    let mut at = content.len() - rest.len();
    for line in rest.split_inclusive('\n') {
        if line.trim_end() == "---" {
            return (Some(&content[content.len() - rest.len()..at]), at + line.len());
        }
        at += line.len();
    }
    (None, 0)
}

fn clean(name: &str) -> Option<String> {
    let name = name.trim().trim_matches(|c| c == '"' || c == '\'').trim_start_matches('#');
    (!name.is_empty() && name.chars().all(tag_char) && !name.chars().all(|c| c.is_ascii_digit()))
        .then(|| name.to_string())
}

fn property_tags(block: &str, out: &mut Vec<String>) {
    let mut in_list = false;
    for line in block.lines() {
        if in_list {
            if let Some(item) = line.trim_start().strip_prefix("- ") {
                out.extend(clean(item));
                continue;
            }
            in_list = false;
        }
        let Some((key, value)) = line.split_once(':') else { continue };
        if !PROPERTY_KEYS.contains(&key.trim().to_lowercase().as_str()) || line.starts_with(' ') {
            continue;
        }
        let value = value.trim();
        if value.is_empty() {
            in_list = true;
        } else {
            let list = value.trim_start_matches('[').trim_end_matches(']');
            out.extend(list.split([',', ' ']).filter_map(clean));
        }
    }
}

fn text_tags(text: &str, out: &mut Vec<String>) {
    let mut fence: Option<&str> = None;
    for line in text.lines() {
        let trimmed = line.trim_start();
        if let Some(open) = fence {
            if trimmed.starts_with(open) {
                fence = None;
            }
            continue;
        }
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            fence = Some(&trimmed[..3]);
            continue;
        }
        let chars: Vec<char> = line.chars().collect();
        let mut code = false;
        let mut link = 0;
        let mut i = 0;
        while i < chars.len() {
            let c = chars[i];
            if c == '`' {
                code = !code;
            } else if !code && c == '[' && chars.get(i + 1) == Some(&'[') {
                link += 1;
                i += 1;
            } else if !code && c == ']' && chars.get(i + 1) == Some(&']') && link > 0 {
                link -= 1;
                i += 1;
            } else if !code && link == 0 && c == '#' && (i == 0 || !(tag_char(chars[i - 1]) || chars[i - 1] == '&')) {
                let name: String = chars[i + 1..].iter().take_while(|c| tag_char(**c)).collect();
                let name = name.trim_end_matches(['/', '-']);
                // `#` followed by a space is a heading, and `#123` an issue number.
                if !name.is_empty() && !name.chars().all(|c| c.is_ascii_digit()) {
                    out.push(name.to_string());
                }
                i += name.chars().count();
            }
            i += 1;
        }
    }
}

/// Every tag of a note, in the order they appear, each once (ignoring case and accents).
pub fn tags(content: &str) -> Vec<String> {
    let (block, body) = frontmatter(content);
    let mut found = Vec::new();
    if let Some(block) = block {
        property_tags(block, &mut found);
    }
    text_tags(&content[body..], &mut found);
    let mut seen = std::collections::HashSet::new();
    found.retain(|t| seen.insert(fold(t)));
    found
}

/// Whether a note's tag is `wanted` or inside it: `proyecto` matches `proyecto/web`.
pub fn tag_matches(tag: &str, wanted: &str) -> bool {
    let (tag, wanted) = (fold(tag), fold(wanted.trim_start_matches('#')));
    tag == wanted || tag.starts_with(&format!("{wanted}/"))
}

/// A tag and how many notes have it.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct TagCount {
    /// As written the first time it was found.
    pub tag: String,
    pub notes: usize,
}

/// Every tag in a vault, the most used first, then by name.
pub fn vault_tags(vault: &crate::VaultFs) -> crate::Result<Vec<TagCount>> {
    let mut counts: std::collections::HashMap<String, TagCount> = std::collections::HashMap::new();
    let listing = vault.listing()?;
    for path in listing.paths() {
        let Ok(note) = listing.read(path) else { continue };
        for tag in tags(&note.content) {
            counts.entry(fold(&tag)).or_insert(TagCount { tag, notes: 0 }).notes += 1;
        }
    }
    let mut out: Vec<TagCount> = counts.into_values().collect();
    out.sort_by(|a, b| b.notes.cmp(&a.notes).then_with(|| fold(&a.tag).cmp(&fold(&b.tag))));
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_tags_in_the_text() {
        let note = "# Título\n\nHablamos de #proyecto y #cliente/acme, no de C#.\n## Otro título\n#123 no\n";
        assert_eq!(tags(note), ["proyecto", "cliente/acme"]);
    }

    #[test]
    fn leaves_out_code_and_links() {
        let note = "`#codigo` y [[nota#parte]]\n```\n#dentro\n```\n#fuera\n";
        assert_eq!(tags(note), ["fuera"]);
    }

    #[test]
    fn reads_the_properties_in_both_forms() {
        assert_eq!(tags("---\ntags: [uno, dos]\n---\n#tres\n"), ["uno", "dos", "tres"]);
        assert_eq!(tags("---\netiquetas:\n  - Reunión\n  - '#acta'\ntitulo: x\n---\n"), ["Reunión", "acta"]);
        assert_eq!(tags("---\ntags: uno dos\n---\n"), ["uno", "dos"]);
    }

    #[test]
    fn each_tag_once_and_nested_ones_match_their_parent() {
        assert_eq!(tags("#Reunion #reunión"), ["Reunion"]);
        assert!(tag_matches("proyecto/web", "proyecto"));
        assert!(tag_matches("Reunión", "#reunion"));
        assert!(!tag_matches("proyectos", "proyecto"));
    }

    #[test]
    fn a_vault_counts_notes_per_tag() {
        let d = tempfile::tempdir().unwrap();
        let v = crate::VaultFs::new(d.path());
        v.write("a.md", "#plan #Cliente", crate::WriteMode::Create).unwrap();
        v.write("b.md", "#cliente y #cliente", crate::WriteMode::Create).unwrap();
        let found = vault_tags(&v).unwrap();
        assert_eq!(found[0], TagCount { tag: "Cliente".into(), notes: 2 });
        assert_eq!(found[1], TagCount { tag: "plan".into(), notes: 1 });
    }
}
