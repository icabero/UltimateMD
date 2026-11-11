//! Cleans an SVG that comes from outside, such as one an AI drew, before it is
//! saved in a vault. Only drawing elements and attributes survive: no scripts,
//! no event handlers, no foreign content and nothing that loads from elsewhere.
//! The app shows SVGs as images, which run nothing anyway; this also keeps the
//! file safe when opened in a browser or embedded somewhere else.

use crate::{Error, Result};
use quick_xml::events::{BytesStart, Event};
use quick_xml::{Reader, Writer};

/// The largest SVG accepted, in bytes.
pub const MAX_SIZE: usize = 2 * 1024 * 1024;

const SVG_NS: &str = "http://www.w3.org/2000/svg";

const ELEMENTS: &[&str] = &[
    "svg",
    "g",
    "defs",
    "symbol",
    "use",
    "title",
    "desc",
    "metadata",
    "style",
    "path",
    "rect",
    "circle",
    "ellipse",
    "line",
    "polyline",
    "polygon",
    "text",
    "tspan",
    "textPath",
    "marker",
    "linearGradient",
    "radialGradient",
    "stop",
    "clipPath",
    "mask",
    "pattern",
    "filter",
    "feBlend",
    "feColorMatrix",
    "feComposite",
    "feDropShadow",
    "feFlood",
    "feGaussianBlur",
    "feMerge",
    "feMergeNode",
    "feMorphology",
    "feOffset",
];

fn invalid(what: &str) -> Error {
    Error::Vault(format!("not a usable SVG: {what}"))
}

/// A reference that stays inside the drawing: `#id` or `url(#id)`.
fn loads_from_outside(value: &str) -> bool {
    let squeezed: String = value.chars().filter(|c| !c.is_whitespace()).collect::<String>().to_ascii_lowercase();
    if squeezed.contains("javascript:") || squeezed.contains("@import") || squeezed.contains("expression(") {
        return true;
    }
    squeezed.match_indices("url(").any(|(i, _)| {
        let rest = squeezed[i + 4..].trim_start_matches(['"', '\'']);
        !rest.starts_with('#')
    })
}

fn clean_start(start: &BytesStart) -> Result<BytesStart<'static>> {
    let name = start.name().as_ref().to_string();
    let mut out = BytesStart::new(name.clone());
    let mut has_ns = false;
    for attr in start.attributes() {
        let attr = attr.map_err(|_| invalid("broken attribute"))?;
        let key = attr.key.as_ref().to_string();
        let value = attr
            .normalized_value(quick_xml::XmlVersion::Implicit1_0)
            .map_err(|_| invalid("broken attribute"))?
            .into_owned();
        let lower = key.to_ascii_lowercase();
        if lower.starts_with("on") || loads_from_outside(&value) {
            continue;
        }
        if (lower == "href" || lower.ends_with(":href")) && !value.starts_with('#') {
            continue;
        }
        has_ns |= lower == "xmlns";
        out.push_attribute((key.as_str(), value.as_str()));
    }
    // An SVG shown as an image needs its namespace.
    if name == "svg" && !has_ns {
        out.push_attribute(("xmlns", SVG_NS));
    }
    Ok(out)
}

/// Returns the SVG with only what is safe to keep. Fails when it is not an SVG.
pub fn clean(svg: &str) -> Result<String> {
    if svg.len() > MAX_SIZE {
        return Err(invalid("too large"));
    }
    let mut reader = Reader::from_str(svg);
    let mut writer = Writer::new(Vec::new());
    // How deep inside an element that is left out with all it holds.
    let mut skipping = 0usize;
    let mut root_open = false;
    let mut root_done = false;
    let mut depth = 0usize;
    // A <style> is kept only once its whole text is known to be harmless.
    let mut style: Option<(BytesStart<'static>, String)> = None;
    let mut put = |event: Event| writer.write_event(event).map_err(|_| invalid("cannot write"));
    loop {
        let event = reader.read_event().map_err(|e| invalid(&e.to_string()))?;
        match event {
            Event::Eof => break,
            Event::Start(start) => {
                if skipping > 0 {
                    skipping += 1;
                    continue;
                }
                let name = start.name().as_ref().to_string();
                if !root_open {
                    if name != "svg" || root_done {
                        return Err(invalid("the root is not <svg>"));
                    }
                    root_open = true;
                }
                if !ELEMENTS.contains(&name.as_str()) || style.is_some() {
                    skipping = 1;
                    continue;
                }
                depth += 1;
                let clean = clean_start(&start)?;
                if name == "style" {
                    style = Some((clean, String::new()));
                } else {
                    put(Event::Start(clean))?;
                }
            }
            Event::Empty(start) => {
                if skipping > 0 || style.is_some() {
                    continue;
                }
                let name = start.name().as_ref().to_string();
                if !root_open {
                    if name != "svg" || root_done {
                        return Err(invalid("the root is not <svg>"));
                    }
                    root_done = true;
                }
                if ELEMENTS.contains(&name.as_str()) && name != "style" {
                    put(Event::Empty(clean_start(&start)?))?;
                }
            }
            Event::End(end) => {
                if skipping > 0 {
                    skipping -= 1;
                    continue;
                }
                if let Some((start, text)) = style.take() {
                    if !loads_from_outside(&text) {
                        put(Event::Start(start))?;
                        put(Event::Text(quick_xml::events::BytesText::from_escaped(text)))?;
                        put(Event::End(end))?;
                    }
                    depth -= 1;
                    continue;
                }
                put(Event::End(end))?;
                depth -= 1;
                if depth == 0 {
                    root_open = false;
                    root_done = true;
                }
            }
            Event::Text(text) if skipping == 0 && root_open => match &mut style {
                Some((_, body)) => body.push_str(&text),
                None => put(Event::Text(text))?,
            },
            Event::CData(data) if skipping == 0 && root_open => match &mut style {
                Some((_, body)) => body.push_str(&data),
                None => put(Event::CData(data))?,
            },
            // Only the entities every XML knows, or numbers; never a DTD's own.
            Event::GeneralRef(entity) if skipping == 0 && root_open => {
                let name = entity.to_string();
                let known = ["amp", "lt", "gt", "quot", "apos"].contains(&name.as_str()) || name.starts_with('#');
                match (&mut style, known) {
                    (Some((_, body)), true) => body.push_str(&format!("&{name};")),
                    (None, true) => put(Event::GeneralRef(entity))?,
                    _ => {}
                }
            }
            // Declarations, doctypes, comments and processing instructions go.
            _ => {}
        }
    }
    if !root_done {
        return Err(invalid("no complete <svg>"));
    }
    String::from_utf8(writer.into_inner()).map_err(|_| invalid("not text"))
}

#[cfg(test)]
mod tests {
    use super::clean;

    #[test]
    fn drawing_stays_and_what_runs_or_loads_goes() {
        let svg = r##"<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x "boom">]><svg viewBox="0 0 10 10" onload="alert(1)"><script>alert(1)</script><style>.a{fill:#123456}</style><g class="a"><rect width="5" height="5" fill="url(#g)" onclick="x()"/><text x="1">A &amp; B &x;</text><foreignObject><div>html</div></foreignObject><a href="https://e.com"><circle r="1"/></a><use href="#r"/><use href="https://e.com/s.svg#r"/><image href="https://e.com/p.png"/></g><style>@import url(https://e.com/x.css);</style><path d="M0 0" style="fill:url(https://e.com/t)"/></svg>"##;
        let out = clean(svg).unwrap();
        for gone in [
            "script",
            "alert",
            "onload",
            "onclick",
            "foreignObject",
            "html",
            "https://",
            "@import",
            "DOCTYPE",
            "boom",
            "<a ",
            "<image",
            "&x;",
            "style=\"",
        ] {
            assert!(!out.contains(gone), "{gone} in {out}");
        }
        for kept in [
            r#"xmlns="http://www.w3.org/2000/svg""#,
            "<style>.a{fill:#123456}</style>",
            r#"fill="url(#g)""#,
            "A &amp; B",
            r##"<use href="#r"/>"##,
            r#"<path d="M0 0"/>"#,
        ] {
            assert!(out.contains(kept), "{kept} not in {out}");
        }
    }

    #[test]
    fn only_an_svg_is_accepted() {
        assert!(clean("<html><svg/></html>").is_err());
        assert!(clean("no es xml").is_err());
        assert!(clean("<svg><g>").is_err());
        assert!(clean("<svg/><svg/>").is_err());
        assert!(clean(&format!("<svg>{}</svg>", "x".repeat(super::MAX_SIZE))).is_err());
        assert_eq!(
            clean(r#"<svg xmlns="http://www.w3.org/2000/svg"/>"#).unwrap(),
            r#"<svg xmlns="http://www.w3.org/2000/svg"/>"#
        );
    }
}
