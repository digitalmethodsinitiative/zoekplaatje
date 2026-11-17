"""Build the PDF of the data dictionary from its Markdown

    python docs/build_pdf.py

This reads docs/data-dictionary-naver-daum.md and writes
docs/zoekplaatje-data-dictionary-naver-daum-<commit>.pdf, with a linked list
of contents on the first page and bookmarks for the sections. The commit and
the date in the footer of each page come from the table under "Version of the
code" in the Markdown: update that table first.

It needs Python 3.9 or newer (no packages) and Google Chrome, Chromium or
Microsoft Edge, which prints the page. The browser is found in the usual
places; else give it with --browser or the environment variable CHROME.

Options:
    python docs/build_pdf.py other.md          # another Markdown file
    python docs/build_pdf.py --output out.pdf  # another PDF file
    python docs/build_pdf.py --html page.html  # also keep the HTML, to check the layout

The Markdown may use what the data dictionary uses: headings (#, ##, ###),
paragraphs, lists (- and 1.), tables, `code`, **bold**, *italic* and
[links](#heading). Links to headings use the anchors that GitHub makes.
"""
import argparse
import html
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_SOURCE = HERE / 'data-dictionary-naver-daum.md'

SUBTITLE = 'What each column of the Naver and Daum exports holds, and where its value comes from'
# sections (## headings) that start on a new page; other names just do not
PAGE_BREAK_BEFORE = {'Results file: columns', 'Item types', 'Block types', 'Extra fields', 'Pages file'}

# the fonts of Windows first; Hangul needs a font that has it (Malgun Gothic, Apple SD Gothic Neo, Noto Sans KR)
SANS = '"Segoe UI", "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", "Noto Sans CJK KR", sans-serif'
MONO = 'Consolas, Menlo, "DejaVu Sans Mono", "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans Mono CJK KR", monospace'

CSS = """
@page { size: A4; margin: 16mm 14mm 16mm 14mm;
  @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 7.5pt __SANS__; color: #777; }
  @bottom-left { content: "__FOOTER__"; font: 7.5pt __SANS__; color: #777; }
}
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font-family: __SANS__; font-size: 9.4pt; line-height: 1.42; color: #1d1d1f; background: #fff; margin: 0; }
h1 { font-size: 21pt; margin: 0 0 2mm; letter-spacing: -0.2pt; }
h1 + p.subtitle { margin: 0 0 6mm; color: #555; font-size: 10.5pt; }
h2 { font-size: 13.5pt; margin: 7mm 0 2.5mm; padding-bottom: 1mm; border-bottom: 1.2pt solid #2b5797; color: #12355f; break-after: avoid; }
h2.break { break-before: page; margin-top: 0; }
h3 { font-size: 11pt; margin: 5mm 0 2mm; color: #12355f; break-after: avoid; }
p { margin: 0 0 2.4mm; }
ul, ol { margin: 0 0 2.6mm; padding-left: 6mm; }
li { margin: 0 0 1mm; }
code { font-family: __MONO__; font-size: 0.92em; background: #eef1f5; padding: 0 0.7mm; border-radius: 1mm; overflow-wrap: anywhere; }
a { color: #2b5797; text-decoration: underline; text-decoration-color: #b9c3d1; }
table { border-collapse: collapse; width: 100%; margin: 1.5mm 0 4mm; font-size: 8.2pt; line-height: 1.35; }
thead { display: table-header-group; }
th { background: #e3e9f2; text-align: left; font-weight: 600; }
th, td { border: 0.5pt solid #b9c3d1; padding: 1.2mm 1.6mm; vertical-align: top; }
tr { break-inside: avoid; }
tbody tr:nth-child(even) td { background: #f7f9fc; }
/* names in the first two columns stay whole; long values in descriptions may break */
td:nth-child(-n+2) code { white-space: nowrap; overflow-wrap: normal; }
table.meta { width: auto; min-width: 70%; font-size: 9pt; border: 1pt solid #2b5797; }
table.meta td { background: #fff !important; border: none; border-bottom: 0.5pt solid #d5dce6; padding: 1.5mm 3mm; }
table.meta td:first-child { white-space: nowrap; color: #12355f; }
nav.contents { margin: 5mm 0 2mm; padding: 3mm 4mm; background: #f3f6fa; border-left: 1.2pt solid #2b5797; break-inside: avoid; }
nav.contents .contents-title { font-weight: 600; color: #12355f; margin: 0 0 1.5mm; }
nav.contents ol { columns: 2; column-gap: 8mm; margin: 0; padding-left: 5mm; }
nav.contents li { break-inside: avoid; margin: 0 0 0.8mm; }
nav.contents ul { margin: 0.5mm 0 0; padding-left: 4mm; list-style: circle; }
"""


def slug(text):
    """The anchor that GitHub makes for a heading"""
    text = re.sub(r'<[^>]+>', '', text).lower()
    text = re.sub(r'[^\w\- ]', '', text)
    return text.replace(' ', '-')


def inline(text):
    """HTML for the text of a line: code, bold, italic and links"""
    codes = []

    def keep(match):
        codes.append('<code>' + html.escape(match.group(1)) + '</code>')
        return '\x00%d\x00' % (len(codes) - 1)

    text = re.sub(r'`([^`]+)`', keep, text)
    text = html.escape(text, quote=False)
    text = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', text)
    text = re.sub(r'(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])', r'<em>\1</em>', text)
    text = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', lambda m: '<a href="%s">%s</a>' % (html.escape(m.group(2)), m.group(1)), text)
    return re.sub(r'\x00(\d+)\x00', lambda m: codes[int(m.group(1))], text)


def cells(line):
    return [cell.strip() for cell in line.strip().strip('|').split('|')]


def contents(headings):
    """A linked list of the sections (## headings, with their ### headings)"""
    sections = []
    for level, anchor, label in headings:
        if level == 2:
            sections.append((anchor, label, []))
        elif level == 3 and sections:
            sections[-1][2].append((anchor, label))
    out = ['<nav class="contents"><p class="contents-title">Contents</p><ol>']
    for anchor, label, children in sections:
        out.append('<li><a href="#%s">%s</a>' % (anchor, label))
        if children:
            out.append('<ul>' + ''.join('<li><a href="#%s">%s</a></li>' % child for child in children) + '</ul>')
        out.append('</li>')
    out.append('</ol></nav>')
    return ''.join(out)


def body_html(lines):
    """HTML for the Markdown. The contents go after the first section (the version of the code)."""
    out = []
    headings = []
    sections = 0
    i = 0
    while i < len(lines):
        line = lines[i].rstrip('\n')
        if not line.strip():
            i += 1
            continue
        heading = re.match(r'^(#{1,3}) (.+)$', line)
        if heading:
            level, text = len(heading.group(1)), heading.group(2).strip()
            if level == 2:
                sections += 1
                if sections == 2:
                    out.append('<!--CONTENTS-->')
            if level > 1 and sections >= 2:
                headings.append((level, slug(text), inline(text)))
            classes = ' class="break"' if level == 2 and text in PAGE_BREAK_BEFORE else ''
            out.append('<h%d id="%s"%s>%s</h%d>' % (level, slug(text), classes, inline(text), level))
            if level == 1 and SUBTITLE:
                out.append('<p class="subtitle">%s</p>' % html.escape(SUBTITLE))
            i += 1
            continue
        if line.startswith('|'):
            rows = []
            while i < len(lines) and lines[i].startswith('|'):
                rows.append(cells(lines[i]))
                i += 1
            header, body = rows[0], rows[2:]
            row_html = lambda row: '<tr>' + ''.join('<td>%s</td>' % inline(cell) for cell in row) + '</tr>'
            if not any(header):
                # a table without headings: the box with the version of the code
                out.append('<table class="meta"><tbody>' + ''.join(row_html(row) for row in body) + '</tbody></table>')
            else:
                out.append('<table><thead><tr>' + ''.join('<th>%s</th>' % inline(cell) for cell in header) + '</tr></thead><tbody>'
                           + ''.join(row_html(row) for row in body) + '</tbody></table>')
            continue
        item = re.match(r'^(- |\d+\. )', line)
        if item:
            tag = 'ol' if item.group(1)[0].isdigit() else 'ul'
            out.append('<%s>' % tag)
            while i < len(lines) and re.match(r'^(- |\d+\. )', lines[i]):
                out.append('<li>%s</li>' % inline(re.sub(r'^(- |\d+\. )', '', lines[i].rstrip('\n'))))
                i += 1
            out.append('</%s>' % tag)
            continue
        paragraph = []
        while i < len(lines) and lines[i].strip() and not re.match(r'^(#{1,3} |\||- |\d+\. )', lines[i]):
            paragraph.append(lines[i].strip())
            i += 1
        out.append('<p>%s</p>' % inline(' '.join(paragraph)))
    return '\n'.join(out).replace('<!--CONTENTS-->', contents(headings))


def version_of(lines):
    """The commit and the date of the table under "Version of the code", e.g. ('0eeacdc39d...', '17 November 2026')"""
    commit = updated = ''
    for line in lines:
        row = cells(line) if line.startswith('|') else []
        if len(row) >= 2 and row[0] == '**Commit**':
            match = re.search(r'`([0-9a-f]{7,40})`', row[1])
            commit = match.group(1) if match else ''
        elif len(row) >= 2 and row[0] == '**Updated**':
            updated = re.sub(r'[`*]', '', row[1])
    return commit, updated


def page_html(lines):
    title = next((line[2:].strip() for line in lines if line.startswith('# ')), 'Document')
    commit, updated = version_of(lines)
    footer = ' · '.join(part for part in ['Zoekplaatje ' + title[0].lower() + title[1:],
                                          'commit ' + commit[:7] if commit else '',
                                          'updated ' + updated if updated else ''] if part)
    css = (CSS.replace('__FOOTER__', footer.replace('\\', '\\\\').replace('"', '\\"'))
           .replace('__SANS__', SANS).replace('__MONO__', MONO))
    return ('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Zoekplaatje %s</title><style>%s</style>'
            '</head><body>%s</body></html>') % (html.escape(title[0].lower() + title[1:]), css, body_html(lines)), commit


def find_browser(given=None):
    """Chrome, Chromium or Edge: the one given, else the first in the usual places"""
    candidates = [given, os.environ.get('CHROME')]
    for variable in ['PROGRAMFILES', 'PROGRAMFILES(X86)', 'LOCALAPPDATA']:
        base = os.environ.get(variable)
        if base:
            candidates += [os.path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'),
                           os.path.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe')]
    candidates += ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                   '/Applications/Chromium.app/Contents/MacOS/Chromium',
                   '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
    candidates += [shutil.which(name) for name in
                   ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'chrome', 'msedge']]
    for candidate in candidates:
        if candidate and os.path.isfile(candidate):
            return candidate
    return None


def print_pdf(browser, html_file, pdf_file, profile):
    """Let the browser print the page to a PDF, with bookmarks for the headings"""
    command = [browser, '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
               '--no-pdf-header-footer', '--generate-pdf-document-outline',
               '--user-data-dir=' + str(profile), '--print-to-pdf=' + str(pdf_file), html_file.as_uri()]
    subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=180)
    # Edge can return before the file is written: wait until it is there and its size stays the same
    size, deadline = -1, time.time() + 60
    while time.time() < deadline:
        if pdf_file.exists() and pdf_file.stat().st_size > 0 and pdf_file.stat().st_size == size:
            return True
        size = pdf_file.stat().st_size if pdf_file.exists() else -1
        time.sleep(1)
    return pdf_file.exists() and pdf_file.stat().st_size > 0


def main():
    parser = argparse.ArgumentParser(description='Build the PDF of the data dictionary from its Markdown.')
    parser.add_argument('source', nargs='?', default=str(DEFAULT_SOURCE), help='Markdown file (default: %(default)s)')
    parser.add_argument('--output', help='PDF file (default: zoekplaatje-<name>-<commit>.pdf next to the Markdown)')
    parser.add_argument('--html', help='also save the HTML here, to check the layout in a browser')
    parser.add_argument('--browser', help='path of Chrome, Chromium or Edge')
    args = parser.parse_args()

    source = Path(args.source).resolve()
    lines = source.read_text(encoding='utf-8').splitlines(keepends=True)
    page, commit = page_html(lines)
    if not commit:
        print('Warning: no commit in the table under "Version of the code"', file=sys.stderr)
    output = Path(args.output).resolve() if args.output else \
        source.with_name('zoekplaatje-%s%s.pdf' % (source.stem, '-' + commit[:7] if commit else ''))

    browser = find_browser(args.browser)
    if not browser:
        sys.exit('Could not find Chrome, Chromium or Edge. Give its path with --browser or the environment variable CHROME.')

    # build in a folder of its own, so that a failed build does not touch the PDF that is there
    work = Path(tempfile.mkdtemp(prefix='zoekplaatje-pdf-'))
    try:
        html_file = work / 'page.html'
        html_file.write_text(page, encoding='utf-8')
        if args.html:
            shutil.copyfile(html_file, args.html)
        if not print_pdf(browser, html_file, work / 'page.pdf', work / 'profile'):
            sys.exit('The browser did not write a PDF: ' + browser)
        shutil.move(str(work / 'page.pdf'), str(output))
    finally:
        shutil.rmtree(work, ignore_errors=True)
    print('Wrote', output)


if __name__ == '__main__':
    main()
