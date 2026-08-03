import { Router } from "express";
import { LEGAL_CONTACT, PRIVACY_LAST_UPDATED, PRIVACY_POLICY_SECTIONS, TERMS_LAST_UPDATED, TERMS_OF_SERVICE_SECTIONS } from "../content/legalContent";

export const legalRouter = Router();

const renderSectionHtml = (sections: typeof TERMS_OF_SERVICE_SECTIONS) =>
  sections
    .map((section) => {
      const paragraphs = section.paragraphs.map((paragraph) => `<p>${paragraph}</p>`).join("");
      const bullets = section.bullets?.length
        ? `<ul>${section.bullets.map((bullet) => `<li>${bullet}</li>`).join("")}</ul>`
        : "";
      return `<section><h2>${section.title}</h2>${paragraphs}${bullets}</section>`;
    })
    .join("");

const renderLegalPage = (title: string, lastUpdated: string, sections: typeof TERMS_OF_SERVICE_SECTIONS) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} | NLBB</title>
  <style>
    body { font-family: Georgia, "Times New Roman", serif; background: #fefcf8; color: #2a2118; margin: 0; }
    main { max-width: 760px; margin: 0 auto; padding: 32px 20px 48px; }
    h1 { font-size: 2rem; margin: 0 0 8px; }
    .meta { color: #6b5f52; font-size: 0.95rem; margin-bottom: 28px; }
    h2 { font-size: 1.15rem; margin: 24px 0 10px; }
    p, li { line-height: 1.65; font-size: 1rem; }
    ul { padding-left: 1.2rem; }
    footer { margin-top: 36px; padding-top: 18px; border-top: 1px solid #e8dfd0; color: #6b5f52; font-size: 0.95rem; }
    a { color: #8a6f1e; }
  </style>
</head>
<body>
  <main>
    <h1>${title}</h1>
    <p class="meta">Last updated: ${lastUpdated}</p>
    ${renderSectionHtml(sections)}
    <footer>
      <p>Questions? Contact <a href="mailto:${LEGAL_CONTACT.email}">${LEGAL_CONTACT.email}</a> or visit <a href="${LEGAL_CONTACT.website}">${LEGAL_CONTACT.website}</a>.</p>
    </footer>
  </main>
</body>
</html>`;

legalRouter.get("/terms", (_req, res) => {
  res.type("html").send(renderLegalPage("Terms of Service", TERMS_LAST_UPDATED, TERMS_OF_SERVICE_SECTIONS));
});

legalRouter.get("/privacy", (_req, res) => {
  res.type("html").send(renderLegalPage("Privacy Policy", PRIVACY_LAST_UPDATED, PRIVACY_POLICY_SECTIONS));
});
