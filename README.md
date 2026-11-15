# First words

175 short words for learning to read, each with a picture, what it looks like on the page and roughly
how it sounds. A dataset for [Knack](https://github.com/lorien-danger/knack): add it by this repo's link.

| column | |
|---|---|
| word | the word, shown in a reading typeface |
| picture | a link to the word's [Fluent emoji](https://github.com/microsoft/fluentui-emoji) (MIT licence, Microsoft), served by jsDelivr |
| sounds | the phonemes a speech model heard in the word said by four Australian voices (rough: *rat* and *red* come out alike) |
| letters, first letter, last letter, length | the letters |
| shape | each letter as x (small), l (tall) or p (hanging below the line): *dog* is `lxp` |
| group | animal, food, ... |

Suggested practice: show the word, reveal the picture, and mark it yourself (*Read it*).

## Building it

`build/` makes the dataset from `build/words.tsv` (word, picture, group). `build.ts` writes the full version to
`local/` (not in this repo): one row per hand-picked photo, and each word said by four Australian Google voices, so
answers can be spoken. It needs a Google Cloud key (`GC_API_KEY`) and the Knack app checked out beside
`knack-datasets`, because the app's speech code works out how each voice sounds. `publish.ts` turns `local/` into the
files at the top of this repo: one row per word, pictures as links, no recordings.

    cd build && npm install
    npx tsx build.ts
    npx tsx publish.ts

`build/voice-samples/` holds one sample of each Australian voice that was auditioned.
