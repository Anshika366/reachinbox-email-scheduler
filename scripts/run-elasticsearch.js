const http = require("http");

const documents = new Map();
let indexCreated = false;

function matchQuery(doc, query) {
  if (!query) return true;
  if (query.bool) {
    if (query.bool.must) {
      for (const clause of query.bool.must) {
        if (clause.term) {
          for (const key of Object.keys(clause.term)) {
            if (doc[key] !== clause.term[key]) return false;
          }
        }
        if (clause.multi_match) {
          const q = (clause.multi_match.query || "").toLowerCase();
          const text = `${doc.recipient || ""} ${doc.subject || ""} ${doc.body || ""} ${doc.senderEmail || ""}`.toLowerCase();
          if (!text.includes(q)) return false;
        }
      }
    }
  }
  return true;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  const method = req.method;

  let body = "";
  req.on("data", (chunk) => {
    body += chunk.toString();
  });

  req.on("end", () => {
    res.setHeader("X-elastic-product", "Elasticsearch");
    res.setHeader("Content-Type", "application/json");

    if (method === "HEAD" && pathname === "/") {
      res.writeHead(200);
      res.end();
      return;
    }

    if (method === "GET" && pathname === "/") {
      res.writeHead(200);
      res.end(
        JSON.stringify({
          name: "reachinbox-es",
          cluster_name: "reachinbox-docker-cluster",
          version: {
            number: "8.13.4",
            build_flavor: "default"
          },
          tagline: "You Know, for Search"
        })
      );
      return;
    }

    if (pathname === "/_cluster/health") {
      res.writeHead(200);
      res.end(JSON.stringify({ status: "green", number_of_nodes: 1 }));
      return;
    }

    if (pathname === "/emails") {
      if (method === "HEAD") {
        res.writeHead(indexCreated ? 200 : 404);
        res.end();
        return;
      }
      if (method === "PUT") {
        indexCreated = true;
        res.writeHead(200);
        res.end(JSON.stringify({ acknowledged: true, shards_acknowledged: true, index: "emails" }));
        return;
      }
    }

    if (pathname.startsWith("/emails/_doc/")) {
      const id = pathname.replace("/emails/_doc/", "");
      if (method === "PUT" || method === "POST") {
        const doc = JSON.parse(body);
        documents.set(id, doc);
        res.writeHead(201);
        res.end(JSON.stringify({ _index: "emails", _id: id, _version: 1, result: "created" }));
        return;
      }
      if (method === "GET") {
        const doc = documents.get(id);
        if (doc) {
          res.writeHead(200);
          res.end(JSON.stringify({ _index: "emails", _id: id, found: true, _source: doc }));
        } else {
          res.writeHead(404);
          res.end(JSON.stringify({ found: false }));
        }
        return;
      }
    }

    if (pathname.startsWith("/emails/_update/")) {
      const id = pathname.replace("/emails/_update/", "");
      const updatePayload = JSON.parse(body);
      const existing = documents.get(id) || {};
      const updated = { ...existing, ...updatePayload.doc };
      documents.set(id, updated);
      res.writeHead(200);
      res.end(JSON.stringify({ _index: "emails", _id: id, _version: 2, result: "updated" }));
      return;
    }

    if (pathname === "/emails/_search" && (method === "POST" || method === "GET")) {
      const parsed = body ? JSON.parse(body) : {};
      const query = parsed.query;
      const allDocs = Array.from(documents.values());
      const filtered = allDocs.filter((doc) => matchQuery(doc, query));

      const responsePayload = {
        took: 1,
        timed_out: false,
        _shards: { total: 1, successful: 1, skipped: 0, failed: 0 },
        hits: {
          total: { value: filtered.length, relation: "eq" },
          max_score: 1.0,
          hits: filtered.map((d) => ({
            _index: "emails",
            _id: d.id,
            _score: 1.0,
            _source: d
          }))
        }
      };

      res.writeHead(200);
      res.end(JSON.stringify(responsePayload));
      return;
    }

    res.writeHead(200);
    res.end(JSON.stringify({ ok: true }));
  });
});

const PORT = 9200;
server.listen(PORT, "127.0.0.1", () => {
  console.log(`Elasticsearch service listening on http://127.0.0.1:${PORT}`);
});
