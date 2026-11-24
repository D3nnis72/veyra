# Project Writing Style

- Use plain English and consistent Veyra terminology (`Today`, `Plan`, `Calendar`, `Projects`, `Review`, `Focus`, `Goals`, `Blocks`, `Ops`, `Daily Notes`, `Later`, `Settings`).
- Write short declarative sentences; prefer concise bullets and compact tables over narrative walls.
- Never copy TypeScript type definitions, Drizzle SQL schemas, or Zod definitions verbatim into docs. Explain behavioral invariants and boundaries, then link to the owning source file via `groundedIn` and inline paths.
- One canonical owner per concept in `docs/knowledge/`; reference other concepts by knowledge ID (`See → ...`) instead of restating them.
- Keep knowledge leaves under 1,500 words, overviews under 400 words, human docs under 700 words, and agent docs under 500 words.
- Avoid numbered H2 headings outside `type: procedure` docs, and avoid positional references ("section 3", "point 2").
- Replace superseded claims instead of appending corrections or history logs.
