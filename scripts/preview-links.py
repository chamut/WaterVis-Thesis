"""Compatibility links for the old local preview URLs.

Run the app with npm run dev first. All three views now share Vite and src/.
"""
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlsplit

PAGES = {
    '/spatial-grid-minimap-preview.html': '/previews/spatial-grid-minimap-preview.html',
    '/multiparameter-grid-matrix-preview.html': '/previews/multiparameter-grid-matrix-preview.html',
}

class Links(BaseHTTPRequestHandler):
    def do_GET(self):
        path = PAGES.get(urlsplit(self.path).path)
        if path is None:
            self.send_error(404, 'This preview is retired or unknown.')
            return
        self.send_response(307)
        self.send_header('Location', 'http://127.0.0.1:5173' + path)
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()

if __name__ == '__main__':
    HTTPServer(('127.0.0.1', 5186), Links).serve_forever()
