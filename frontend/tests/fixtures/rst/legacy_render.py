# Renders every source of stdin (JSON list of {rst}) with the legacy ParsableText (see collect-corpus.mjs).
import json, sys
import inginious.frontend.i18n as i18n
class S: language = "en"
i18n.session = S()
import flask
from inginious.frontend.parsable_text import ParsableText
app = flask.Flask("x")
items = json.load(sys.stdin)
with app.test_request_context("/"):
    for it in items:
        it["html"] = ParsableText(it["rst"], "rst").parse()
json.dump(items, sys.stdout)
