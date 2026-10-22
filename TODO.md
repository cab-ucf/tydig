# TODO

- **SSO by SAML**: universities sign in through Shibboleth (InCommon,
  eduGAIN). OIDC works today (`TYDIG_SSO_DISCOVERY`); SAML through
  better-auth's SSO plugin would cover the rest.
- **Comments and the Discussion outlive a hub**: today they live in its CRDT
  alone. Kept as text in git notes (with the quoted text, to re-anchor
  by), a rebuilt hub could restore them.
- **Packages without a network**: warm the featured templates' packages
  into the build image, for `TYDIG_BUILD_NET=0`.

From Overleaf, worth weighing:

- Track changes: edits as suggestions, accepted or rejected.
- History: the diff between any two versions; restore one file.
- An outline of the document's headings, to jump by.
- A symbol palette for math.
- Thumbnails in the template picker (page 1 of each, rendered once).
- Reference managers: a Zotero group library as the project's `.bib`.
- A submission bundle: flattened sources and the PDF, for arXiv or a journal.
- Exact click to source, by Typst's own spans (tinymist's preview) where
  text matching cannot tell repeats apart.
