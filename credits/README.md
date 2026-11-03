# Credits and licences

The code in this repo is MIT. **The audio is not**: every clip keeps the licence its author chose, and much of it is
non-commercial only (NC). If you reuse a clip, check its row in the per-clip lists and credit it as shown.

- [clips_real.csv](clips_real.csv): the real-audio map (podcasts, voices, music), one row per clip, in map order.
- [clips_sounds.csv](clips_sounds.csv): the sound-effects map.

Columns: `index` (the clip's number on its map), `dataset`, `clip`, `credit`, `licence`, `licence_url`, `source_url`,
`dataset_credit`. Both files are written by `scripts/credits.py`.

## Datasets

| Dataset | Clips | Licence | Cite |
|---|---|---|---|
| ESC-50 | 2,000 | Dataset CC BY-NC 3.0 (ESC-10 subset CC BY 3.0); clips from Freesound under CC0, CC BY, CC BY-NC or Sampling+ | K. J. Piczak, "ESC: Dataset for Environmental Sound Classification", ACM Multimedia 2015 |
| FSD50K | 2,399 | Dataset CC BY 4.0; clips from Freesound under CC0, CC BY, CC BY-NC or Sampling+ | E. Fonseca, X. Favory, J. Pons, F. Font, X. Serra, "FSD50K: an Open Dataset of Human-Labeled Sound Events", IEEE/ACM TASLP 2022 |
| VocalSound | 600 | CC BY-SA 4.0 | Y. Gong, J. Yu, J. Glass, "VocalSound: A Dataset for Improving Human Vocal Sounds Recognition", ICASSP 2022 |
| CREMA-D | 720 | ODbL 1.0 (database), DbCL 1.0 (contents) | H. Cao, D. G. Cooper, M. K. Keutmann, R. C. Gur, A. Nenkova, R. Verma, "CREMA-D: Crowd-sourced Emotional Multimodal Actors Dataset", IEEE Trans. Affective Computing 2014 |
| xeno-canto | 680 | Per recording: mostly CC BY-NC-SA; some CC0, CC BY-SA, CC BY-NC | Recordings from [xeno-canto.org](https://xeno-canto.org), each credited to its recordist |
| FMA | 1,936 | Per track, chosen by the artist: mostly CC BY-NC variants, some ND; metadata CC BY 4.0 | M. Defferrard, K. Benzi, P. Vandergheynst, X. Bresson, "FMA: A Dataset for Music Analysis", ISMIR 2017 |
| MTG-Jamendo | 1,135 | Tracks under CC licences; the dataset is for non-commercial research and academic use | D. Bogdanov, M. Won, P. Tovstogan, A. Porter, X. Serra, "The MTG-Jamendo Dataset for Automatic Music Tagging", ICML 2019 ML4MD workshop |
| Musopen | 232 | Public Domain Mark 1.0 | Recordings by [Musopen](https://musopen.org), via the Internet Archive |
| Podcasts | 2,808 | Copyright of each publisher. **Not copied**: the public page plays each clip straight from the episode on the publisher's server (the URL in its RSS feed) | 39 shows, minutes 2–10 of three episodes each; each row names the show and episode |

Models: LAION-CLAP (HTS-AT, unfused) and Google's EmbeddingGemma 2, used as published under their own licences.
