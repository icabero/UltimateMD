//! PDF export with Typst, a typesetting engine compiled into the app: real
//! pagination on a white page, the same on every platform, with no dialogs.
//!
//! Note text always reaches Typst as escaped strings, so a note can never run
//! as Typst code, however it is written.

mod markup;

use std::collections::HashMap;
use std::sync::LazyLock;
use typst::diag::{FileError, FileResult};
use typst::foundations::{Bytes, Datetime, Duration};
use typst::syntax::{FileId, RootedPath, Source, VirtualPath, VirtualRoot};
use typst::text::{Font, FontBook};
use typst::utils::LazyHash;
use typst::{Library, LibraryExt, World};
use typst_layout::PagedDocument;
use typst_pdf::{PdfOptions, PdfStandard, PdfStandards, Timestamp};
use typst_render::RenderOptions;
use ultimatemd_core::docx::Section;
use ultimatemd_core::{Error, Result};

pub struct Input<'a> {
    pub sections: &'a [Section],
    pub title: &'a str,
    pub date: &'a str,
    /// A language code, for hyphenation and quotes.
    pub language: &'a str,
    /// The title of the table of contents.
    pub contents: &'a str,
    /// Adds a cover page and a table of contents.
    pub cover: bool,
    /// Writes PDF/A-2b, the archiving standard.
    pub archive: bool,
    /// Rendered diagrams as PNG, in the order they appear. Empty if rendering failed.
    pub diagrams: &'a [Vec<u8>],
    /// Loads an image: note path, then the reference written in it.
    pub image: &'a dyn Fn(&str, &str) -> Option<Vec<u8>>,
}

struct Fonts {
    book: LazyHash<FontBook>,
    fonts: Vec<Font>,
}

static FONTS: LazyLock<Fonts> = LazyLock::new(|| {
    let fonts: Vec<Font> = typst_assets::fonts().flat_map(|data| Font::iter(Bytes::new(data))).collect();
    Fonts { book: LazyHash::new(FontBook::from_fonts(&fonts)), fonts }
});

static LIBRARY: LazyLock<LazyHash<Library>> = LazyLock::new(|| LazyHash::new(Library::default()));

struct Document {
    main: Source,
    files: HashMap<String, Bytes>,
}

fn file_id(path: &str) -> FileId {
    let path = VirtualPath::new(path).expect("generated paths are valid");
    RootedPath::new(VirtualRoot::Project, path).intern()
}

impl World for Document {
    fn library(&self) -> &LazyHash<Library> {
        &LIBRARY
    }

    fn book(&self) -> &LazyHash<FontBook> {
        &FONTS.book
    }

    fn main(&self) -> FileId {
        self.main.id()
    }

    fn source(&self, id: FileId) -> FileResult<Source> {
        if id == self.main.id() { Ok(self.main.clone()) } else { Err(FileError::AccessDenied) }
    }

    fn file(&self, id: FileId) -> FileResult<Bytes> {
        let path = id.get().vpath().get_with_slash();
        self.files.get(path).cloned().ok_or(FileError::AccessDenied)
    }

    fn font(&self, index: usize) -> Option<Font> {
        FONTS.fonts.get(index).cloned()
    }

    fn today(&self, _: Option<Duration>) -> Option<Datetime> {
        None
    }
}

fn compile(input: &Input) -> Result<PagedDocument> {
    // If Typst cannot lay out a formula, the document is built again with the
    // formulas as typed: a note's math never costs the export.
    compile_with(input, true).or_else(|first| compile_with(input, false).map_err(|_| first))
}

fn compile_with(input: &Input, formulas: bool) -> Result<PagedDocument> {
    let (source, images) = markup::build(input, formulas);
    let files = images.into_iter().map(|(name, bytes)| (name, Bytes::new(bytes))).collect();
    let world = Document { main: Source::new(file_id("/main.typ"), source), files };
    typst::compile::<PagedDocument>(&world).output.map_err(|errors| {
        let first = errors.first().map_or("unknown error".to_string(), |e| e.message.to_string());
        Error::Vault(format!("could not lay out the PDF: {first}"))
    })
}

/// The current time in UTC, which PDF/A requires as the creation date.
fn now() -> Option<Timestamp> {
    let seconds = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).ok()?.as_secs() as i64;
    let (days, rest) = (seconds.div_euclid(86_400), seconds.rem_euclid(86_400));
    // Days since 1970-01-01 to a civil date (Howard Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u8;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u8;
    let year = (yoe + era * 400 + i64::from(month <= 2)) as i32;
    let (hour, minute, second) = ((rest / 3_600) as u8, (rest / 60 % 60) as u8, (rest % 60) as u8);
    Datetime::from_ymd_hms(year, month, day, hour, minute, second).map(Timestamp::new_utc)
}

fn pdf_options(input: &Input) -> Result<PdfOptions> {
    if !input.archive {
        return Ok(PdfOptions::default());
    }
    let standards = PdfStandards::new(&[PdfStandard::A_2b])
        .map_err(|e| Error::Vault(format!("could not set up PDF/A: {}", e.message())))?;
    Ok(PdfOptions { standards, timestamp: now(), ..PdfOptions::default() })
}

/// Generates the PDF.
pub fn render(input: &Input) -> Result<Vec<u8>> {
    let document = compile(input)?;
    typst_pdf::pdf(&document, &pdf_options(input)?)
        .map_err(|e| Error::Vault(format!("could not write the PDF: {:?}", e.first().map(|d| d.message.to_string()))))
}

/// Renders the pages as PNG images, exactly as they will print.
pub fn preview(input: &Input, pixels_per_point: f64) -> Result<Vec<Vec<u8>>> {
    let document = compile(input)?;
    let options = RenderOptions { pixel_per_pt: pixels_per_point.into(), ..RenderOptions::default() };
    document
        .pages()
        .iter()
        .map(|page| typst_render::render(page, &options).encode_png().map_err(|e| Error::Vault(e.to_string())))
        .collect()
}

#[cfg(test)]
mod tests;
