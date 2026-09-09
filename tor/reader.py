"""HTTPS reader: public host validation and inert text extraction, no page HTML output."""
import ipaddress
import re
from html.parser import HTMLParser
from urllib.parse import quote, urljoin, urlsplit, urlunsplit

MAX_TEXT = 120000
MAX_BLOCKS = 500

def normalize_url(value):
    if not isinstance(value, str) or not 1 <= len(value) <= 4096:
        raise ValueError('Enter a valid website address.')
    if any(ord(c) <= 32 or ord(c) == 127 for c in value) or '\\' in value:
        raise ValueError('Invalid website address.')
    try:
        parsed = urlsplit(value)
        if parsed.scheme not in ('http', 'https') or parsed.username is not None or parsed.password is not None:
            raise ValueError('Only public HTTPS websites are supported.')
        if parsed.port not in (None, 443) and not (parsed.scheme == 'http' and parsed.port == 80):
            raise ValueError('Only standard web ports are supported.')
        host = (parsed.hostname or '').rstrip('.').encode('idna').decode('ascii').lower()
        try:
            ipaddress.ip_address(host)
        except ValueError:
            pass
        else:
            raise ValueError('IP-address targets are not supported.')
        labels = host.split('.')
        if len(labels) < 2 or not re.search('[a-z]', labels[-1]):
            raise ValueError('Use a public website hostname.')
        if any(not re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?', label) for label in labels):
            raise ValueError('Invalid website hostname.')
        if len(host) > 253 or labels[-1] in ('local', 'localhost', 'internal', 'lan', 'home', 'test', 'invalid', 'example', 'onion'):
            raise ValueError('Private/local hosts are not supported.')
        path = quote(parsed.path or '/', safe="/%:@!$&'()*+,;=-._~")
        query = quote(parsed.query, safe="/%?:@!$&'()*+,;=-._~")
        return urlunsplit(('https', host, path, query, ''))
    except (UnicodeError, ValueError) as error:
        raise ValueError('Use a public HTTPS website with no credentials or special port.') from error

class TextPage(HTMLParser):
    # No source HTML, CSS, scripts, forms, images, embeds, or event handlers are emitted.
    SKIP = {'head', 'script', 'style', 'noscript', 'template', 'svg', 'math', 'iframe', 'object', 'canvas', 'video', 'audio', 'form', 'nav', 'footer'}
    VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'}
    BREAK = {'p', 'div', 'section', 'article', 'main', 'li', 'ul', 'ol', 'blockquote', 'pre', 'tr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'br', 'hr'}
    def __init__(self, base_url):
        super().__init__(convert_charrefs=True)
        self.base_url = base_url
        self.blocks = []
        self.parts = []
        self.skipped = []
        self.link = None
        self.kind = 'paragraph'
        self.total = 0
        self.in_title = False
        self.title = ''
    def flush(self):
        if self.parts and len(self.blocks) < MAX_BLOCKS:
            self.blocks.append({'kind': self.kind, 'segments': self.parts})
        self.parts = []
        self.kind = 'paragraph'
    def handle_starttag(self, tag, attrs):
        if tag == 'title':
            self.in_title = True
        if self.skipped:
            if tag not in self.VOID:
                self.skipped.append(tag)
            return
        if tag in self.SKIP:
            self.flush()
            self.skipped.append(tag)
            return
        if tag in self.BREAK:
            self.flush()
            if tag.startswith('h') and len(tag) == 2 and tag[1].isdigit():
                self.kind = 'heading'
            elif tag == 'pre':
                self.kind = 'pre'
        if tag == 'a':
            href = dict(attrs).get('href') or ''
            try:
                self.link = normalize_url(urljoin(self.base_url, href)) if href and not href.startswith('#') else None
            except ValueError:
                self.link = None
    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in self.VOID:
            self.handle_endtag(tag)
    def handle_endtag(self, tag):
        if tag == 'title':
            self.in_title = False
        if self.skipped:
            if tag in self.skipped:
                self.skipped = self.skipped[:self.skipped.index(tag)]
            return
        if tag == 'a':
            self.link = None
        if tag in self.BREAK:
            self.flush()
    def handle_data(self, data):
        if self.in_title:
            self.title = (self.title + data)[:500]
            return
        if self.skipped or self.total >= MAX_TEXT or len(self.blocks) >= MAX_BLOCKS:
            return
        value = data if self.kind == 'pre' else re.sub(r'\s+', ' ', data)
        if not value.strip():
            # Preserve separation between inline elements.
            if self.parts and not self.parts[-1]['text'].endswith(' '):
                self.parts[-1]['text'] += ' '
            return
        value = value[:MAX_TEXT-self.total]
        self.total += len(value)
        part = {'text': value}
        if self.link:
            part['url'] = self.link
        if self.parts and self.parts[-1].get('url') == part.get('url'):
            self.parts[-1]['text'] += value
        else:
            self.parts.append(part)

def extract_page(body, base_url, content_type):
    mime = content_type.split(';')[0].strip().lower()
    charset = re.search(r'charset\s*=\s*["\']?([a-zA-Z0-9_-]+)', content_type, re.I)
    encoding = charset.group(1) if charset else 'utf-8'
    try:
        text = body.decode(encoding, errors='replace')
    except LookupError:
        text = body.decode('utf-8', errors='replace')
    if mime == 'text/plain':
        return {'url':base_url, 'title':urlsplit(base_url).hostname,
                'blocks':[{'kind':'pre','segments':[{'text':text[:MAX_TEXT]}]}],
                'truncated':len(text)>MAX_TEXT}
    if mime not in ('text/html', 'application/xhtml+xml'):
        raise ValueError('This reader supports HTML pages and plain text, not files or media.')
    parser = TextPage(base_url)
    parser.feed(text)
    parser.close()
    parser.flush()
    return {'url':base_url, 'title':parser.title.strip() or urlsplit(base_url).hostname,
            'blocks':parser.blocks, 'truncated':parser.total>=MAX_TEXT or len(parser.blocks)>=MAX_BLOCKS}
