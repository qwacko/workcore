---
'@workcore/core': minor
'@workcore/client': minor
'@workcore/admin': minor
'@workcore/schema-zod': minor
---

Move the beta admin wire contract to manifest protocol v2 with semantic pages and operation presentations as the only serialized UI model. Rename operation presentation authoring from `ui` to `views`; remove protocol-v1 page and operation-UI projections. Replace legacy table/chat response aliases with canonical `items` pages; add cursor/offset Zod helpers and a unified extensible chat query with typed authored views, optional composer bindings, conversation/thread/run metadata, safe rich content/layout blocks, separately fetched named table/chart views, and searchable/paged thread navigation. Add schema-checked collection/editor/action descriptors, one schema-inferred default query view when views are omitted, safe custom-component placeholders, linked mutation actions, and inline page mutation forms. Explicitly authored variants are exposed without additional generated profiles. Server operation execution, authorization, Standard Schema validation, and codecs remain unchanged.
