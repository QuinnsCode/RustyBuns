# About

Rusty Buns started with grass.

I was making a game and wanted its grass to render faster. That meant putting a fast native engine behind a web page, and doing it without giving up TypeScript or writing the app a second time. Once that worked on a laptop, the same code could also run on the edge and on a server, and the grass turned into a framework.

That's why the [Rust feature](README.md#rust-when-you-need-it-typescript-always) is shaped the way it is. Rust comes in only for the hot path, always has a TypeScript twin that gives the same answer, and the app falls back to the twin if Rust can't load. The rest grew from the same idea: keep the app one plain web app, and let the tool box it up for wherever it needs to run.

It's made by Ryan Quinn ([QuinnsCode](https://github.com/QuinnsCode)), with Claude Code as co-author on nearly every commit. Every example in the [README](README.md#see-it-work) runs on it, and they're how it gets tested.

Rusty Buns is in alpha. Issues and ideas are welcome on [GitHub](https://github.com/QuinnsCode/RustyBuns/issues).
