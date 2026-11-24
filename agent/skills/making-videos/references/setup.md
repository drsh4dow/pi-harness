# Setup

`scripts/check.sh --setup [web] [android] [ios] [compose]` checks a machine before a video. This page says how to install each thing it names.

## Install the skill

Install it for every project with the skills CLI (Node 22 or newer), then start a new agent session so it loads:

```bash
npx skills add drsh4dow/pi-harness --skill making-videos -g
```

The folder carries every script, template and font it uses. Run `scripts/check.sh --setup` from it, and install what it names from the table below.

## Tools

| Tool                          | Needed for                            | Debian, Ubuntu                                                                                                                                                                                                  | Fedora                                                                                                          | Arch                                     | macOS (Homebrew)                             |
| ----------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------- |
| ffmpeg with libx264, ffprobe  | every video                           | `apt install ffmpeg`                                                                                                                                                                                            | enable RPM Fusion, then `dnf swap ffmpeg-free ffmpeg --allowerasing`; Fedora's own `ffmpeg-free` has no libx264 | `pacman -S ffmpeg`                       | `brew install ffmpeg`                        |
| bash 4 or newer               | every video                           | already there                                                                                                                                                                                                   | already there                                                                                                   | already there                            | `brew install bash`; macOS's own bash is 3.2 |
| uv                            | every video                           | `curl -LsSf https://astral.sh/uv/install.sh \| sh`                                                                                                                                                              | same                                                                                                            | `pacman -S uv`                           | `brew install uv`                            |
| python3                       | every video                           | `apt install python3`                                                                                                                                                                                           | `dnf install python3`                                                                                           | `pacman -S python`                       | `brew install python`                        |
| sha256sum                     | every video                           | already there                                                                                                                                                                                                   | already there                                                                                                   | already there                            | `brew install coreutils`                     |
| jq                            | every video                           | `apt install jq`                                                                                                                                                                                                | `dnf install jq`                                                                                                | `pacman -S jq`                           | `brew install jq`                            |
| tesseract                     | every video                           | `apt install tesseract-ocr`                                                                                                                                                                                     | `dnf install tesseract tesseract-langpack-eng`                                                                  | `pacman -S tesseract tesseract-data-eng` | `brew install tesseract`                     |
| Xvfb                          | web                                   | `apt install xvfb`                                                                                                                                                                                              | `dnf install xorg-x11-server-Xvfb`                                                                              | `pacman -S xorg-server-xvfb`             | none                                         |
| xdotool                       | web                                   | `apt install xdotool`                                                                                                                                                                                           | `dnf install xdotool`                                                                                           | `pacman -S xdotool`                      | none                                         |
| xdpyinfo                      | web                                   | `apt install x11-utils`                                                                                                                                                                                         | `dnf install xdpyinfo`                                                                                          | `pacman -S xorg-xdpyinfo`                | none                                         |
| Chromium                      | web                                   | Debian `apt install chromium`, Ubuntu `snap install chromium`                                                                                                                                                   | `dnf install chromium`, then `CHROMIUM=chromium-browser`                                                        | `pacman -S chromium`                     | none                                         |
| agent-browser                 | web                                   | `bun add -g agent-browser && agent-browser install`                                                                                                                                                             | same                                                                                                            | same                                     | same                                         |
| Node 22 or newer              | web, compose                          | a version manager such as fnm, nvm or mise; distro packages are often older, so check `node -v`                                                                                                                 | same                                                                                                            | `pacman -S nodejs npm`                   | `brew install node`                          |
| bun                           | compose, and installing agent-browser | `curl -fsSL https://bun.sh/install \| bash`                                                                                                                                                                     | same                                                                                                            | same                                     | `brew install oven-sh/bun/bun`               |
| adb, emulator, avdmanager     | android                               | Android Studio, or the SDK command-line tools and `sdkmanager "platform-tools" "emulator"`. Add `$ANDROID_HOME/platform-tools`, `$ANDROID_HOME/emulator` and `$ANDROID_HOME/cmdline-tools/latest/bin` to `PATH` | same                                                                                                            | same                                     | same                                         |
| maestro                       | android, ios                          | `curl -fsSL "https://get.maestro.mobile.dev" \| bash`, then add `$HOME/.maestro/bin` to `PATH`                                                                                                                  | same                                                                                                            | same                                     | same                                         |
| java 17 or newer, for maestro | android, ios                          | `apt install default-jdk`; Ubuntu 22.04 needs `openjdk-17-jdk`                                                                                                                                                  | `dnf install java-latest-openjdk`                                                                               | `pacman -S jdk-openjdk`                  | `brew install --cask temurin`                |
| xcrun with simctl             | ios                                   | none                                                                                                                                                                                                            | none                                                                                                            | none                                     | Xcode from the App Store                     |

- Web capture runs Chromium on a virtual X display (Xvfb), so it works on Linux only. On a Mac, record the web app on a Linux machine.
- Set `CHROMIUM` to the browser's command when it is not called `chromium`. Use Chromium itself: `window.py` finds its window by the class name `chromium`.
- Remotion, which draws composed films, installs per film with `bun install` in the copied template. See `templates/remotion/README.md`.

## Voice keys

`scripts/tts.py` voices the script with Gemini (`GEMINI_API_KEY`) in the voice Iapetus, or ElevenLabs (`ELEVENLABS_API_KEY`) in the voice Mark. One key is enough. Recommend Gemini: its free tier voices short videos, within a daily quota.

- **Gemini.** Sign in at https://aistudio.google.com/apikey and click Create API key. Google's own tools also read `GOOGLE_API_KEY`, but `tts.py` reads only `GEMINI_API_KEY`.
- **ElevenLabs.** Create a key at https://elevenlabs.io/app/settings/api-keys. A key can be limited to some endpoints. Allow text to speech, and music too if you want `scripts/music.sh` to make a music bed.

`sync.py` times captions with the speech model faster-whisper `small.en` (or `WHISPER_MODEL`) and never downloads it. When `check.sh --setup` names it, download it once:

```bash
uv run --no-project --with faster-whisper python3 -c "from faster_whisper import WhisperModel; WhisperModel(__import__('os').environ.get('WHISPER_MODEL', 'small.en'))"
```

Set the key yourself in a terminal, never in the agent's chat. Add one line to `~/.bashrc` or `~/.zshrc`, with your key in place of the dots:

```bash
export GEMINI_API_KEY=...
```

Open a new terminal, start a new agent session from it, and run `check.sh --setup` again.

**No key, captions only.** The video runs with no voice. Voice it with `narrate.py --voice captions` (SKILL.md step 3) and check the export with `check.sh --profile captions`.

**A key that fails.** `--setup` sees only that a key is set. A bad key, no credits or a spent daily quota fails that provider when `narrate.py` runs, and it moves on to the next voice in its chain, Iapetus then Mark (`tts.py --help` has the rules). When neither voices the script, `narrate.py` fails: ask the user for a working key or captions only. `narrate.py` prints the voice that ran, so tell the user which one it was.
