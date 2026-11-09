//! Callouts, the coloured boxes of Obsidian (`> [!warning] Title`). Exports
//! turn them into GitHub alerts (`> [!WARNING]`), which pulldown-cmark reads
//! as five kinds, followed by their title in bold.

/// The five kinds every callout type falls into, as GitHub alerts name them.
pub const KINDS: [&str; 5] = ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"];

/// Each type: its kind, and its name in Spanish, English and Basque, which is
/// the title when none is written. The frontend keeps the same table.
const TYPES: &[(&[&str], &str, [&str; 3])] = &[
    (&["note"], "NOTE", ["Nota", "Note", "Oharra"]),
    (&["info"], "NOTE", ["Información", "Info", "Informazioa"]),
    (&["todo"], "NOTE", ["Pendiente", "To do", "Egiteko"]),
    (&["abstract", "summary", "tldr"], "NOTE", ["Resumen", "Summary", "Laburpena"]),
    (&["example"], "NOTE", ["Ejemplo", "Example", "Adibidea"]),
    (&["quote", "cite"], "NOTE", ["Cita", "Quote", "Aipua"]),
    (&["tip", "hint"], "TIP", ["Consejo", "Tip", "Aholkua"]),
    (&["success", "check", "done"], "TIP", ["Hecho", "Done", "Eginda"]),
    (&["important"], "IMPORTANT", ["Importante", "Important", "Garrantzitsua"]),
    (&["question", "help", "faq"], "IMPORTANT", ["Pregunta", "Question", "Galdera"]),
    (&["warning", "caution", "attention"], "WARNING", ["Aviso", "Warning", "Abisua"]),
    (&["failure", "fail", "missing"], "CAUTION", ["Fallo", "Failure", "Hutsegitea"]),
    (&["danger", "error"], "CAUTION", ["Peligro", "Danger", "Arriskua"]),
    (&["bug"], "CAUTION", ["Error", "Bug", "Akatsa"]),
];

fn language_index(language: &str) -> usize {
    match language.split(['-', '_']).next().unwrap_or("") {
        "en" => 1,
        "eu" => 2,
        _ => 0,
    }
}

/// The kind and default title of a callout type. Unknown types are notes
/// titled with their own name, as Obsidian shows them.
pub fn describe(kind: &str, language: &str) -> (&'static str, String) {
    let lower = kind.to_lowercase();
    match TYPES.iter().find(|(names, ..)| names.contains(&lower.as_str())) {
        Some((_, kind, titles)) => (kind, titles[language_index(language)].to_string()),
        None => {
            let mut chars = lower.chars();
            let title = chars.next().map(|c| c.to_uppercase().chain(chars).collect()).unwrap_or_default();
            ("NOTE", title)
        }
    }
}

/// `> [!type] Title` or `> [!type]- Title` at the start of a quote. Returns the
/// quote marker, the type and the title.
fn opening(line: &str) -> Option<(&str, &str, &str)> {
    let after_indent = line.len() - line.trim_start_matches(' ').len();
    if after_indent > 3 || !line[after_indent..].starts_with('>') {
        return None;
    }
    let mut marker_end = after_indent + 1;
    if line[marker_end..].starts_with(' ') {
        marker_end += 1;
    }
    let rest = line[marker_end..].strip_prefix("[!")?;
    let close = rest.find(']')?;
    let kind = &rest[..close];
    if kind.is_empty() || !kind.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_') {
        return None;
    }
    let title = rest[close + 1..].trim_start_matches(['+', '-']).trim();
    Some((&line[..marker_end], kind, title))
}

/// Rewrites callouts as GitHub alerts with a bold title line, outside code.
pub fn normalize(markdown: &str, language: &str) -> String {
    let mut out = String::with_capacity(markdown.len() + 64);
    let mut fence: Option<&str> = None;
    let mut in_quote = false;
    for line in markdown.split_inclusive('\n') {
        let bare = line.trim_end_matches(['\n', '\r']);
        let trimmed = bare.trim_start();
        let marker = ["```", "~~~"].into_iter().find(|m| trimmed.starts_with(m));
        match (fence, marker) {
            (None, Some(m)) => fence = Some(m),
            (Some(open), Some(m)) if open == m => fence = None,
            _ => {}
        }
        let starts_quote = fence.is_none() && marker.is_none() && !in_quote;
        if let (true, Some((prefix, kind, title))) = (starts_quote, opening(bare)) {
            let (kind, default) = describe(kind, language);
            let title = if title.is_empty() { default } else { title.to_string() };
            let eol = &line[bare.len()..];
            let eol = if eol.is_empty() { "\n" } else { eol };
            // An empty quote line after the title keeps it a paragraph of its own.
            let empty = prefix.trim_end();
            out.push_str(&format!("{prefix}[!{kind}]{eol}{prefix}**{title}**{eol}{empty}{eol}"));
        } else {
            out.push_str(line);
        }
        in_quote = fence.is_none() && trimmed.starts_with('>');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn callouts_become_alerts_with_a_title() {
        let md = "> [!warning] Cuidado\n> Hielo fino.\n";
        assert_eq!(normalize(md, "es"), "> [!WARNING]\n> **Cuidado**\n>\n> Hielo fino.\n");
        assert_eq!(normalize("> [!tip]\n> Texto\n", "es"), "> [!TIP]\n> **Consejo**\n>\n> Texto\n");
        assert_eq!(normalize("> [!faq]- Plegado\n> x", "en"), "> [!IMPORTANT]\n> **Plegado**\n>\n> x");
        assert_eq!(normalize("> [!danger]\n", "eu"), "> [!CAUTION]\n> **Arriskua**\n>\n");
    }

    #[test]
    fn unknown_types_are_notes_with_their_name() {
        assert_eq!(normalize("> [!receta]\n> x\n", "es"), "> [!NOTE]\n> **Receta**\n>\n> x\n");
    }

    #[test]
    fn only_the_first_line_of_a_quote_and_never_code() {
        let quote = "> texto\n> [!note] no\n";
        assert_eq!(normalize(quote, "es"), quote);
        let code = "```\n> [!note] no\n```\n";
        assert_eq!(normalize(code, "es"), code);
        let link = "> [!note](url)\n";
        assert_eq!(normalize(link, "es"), "> [!NOTE]\n> **(url)**\n>\n");
        assert_eq!(normalize("Texto [!note]\n", "es"), "Texto [!note]\n");
    }

    #[test]
    fn line_endings_are_kept() {
        assert_eq!(normalize("> [!note] A\r\n> b\r\n", "es"), "> [!NOTE]\r\n> **A**\r\n>\r\n> b\r\n");
    }
}
