# Custom Apps on Mazda MZD v74 JCI — Research & Implementation Guide

## Background

This document captures the research and implementation of a method for adding custom applications
to the Mazda MZD Connect infotainment system (firmware v74.00.324A EU), **without modifying any
stock firmware files**. The implemented example is the "Hello World" app — a settings-style screen
that demonstrates all stock UI components.

The constraint of zero edits to stock files is the same constraint that CarPlay and Android Auto
satisfy: they appear in the Applications menu only because the system detected them and loaded their
code; the firmware itself was not altered.

---

## Architecture Overview

The MZD Connect GUI layer runs inside the Opera browser (Presto engine), rendering HTML/CSS and
executing JavaScript. There are two layers to understand:

### MMUI (native, compiled)
The native C++ process that manages application focus, hardware events, and overall system state.
It communicates with the GUI via a WebSocket-based IPC protocol. It is **not patchable at runtime**
— only the GUI layer is.

### JCI GUI (JavaScript/HTML, patchable)
The JavaScript UI layer. All screens are rendered here. The framework (`GuiFramework.js`) manages
context (screen) transitions, template instantiation, and routing of events between MMUI and app
instances. This layer is fully patchable from new JS files loaded at runtime.

### Partition layout on the real CMU

```
/jci/         — main firmware (read-only in normal operation)
  gui/        — all JavaScript UI code
    index.html
    framework/
    apps/
      system/
      audiosettings/
      ...
/data/        — writable partition (persists across reboots, used for config and scripts)
  integration/
    developer_mode_GuiConfig.js   ← auto-loaded by index.html if it exists
```

The key insight: **`index.html` already has a hook** that loads
`../../data/integration/developer_mode_GuiConfig.js` at boot — but only if the file exists. On a
stock CMU it does not exist, so nothing happens. Dropping a file there is sufficient to run
arbitrary JavaScript at GUI startup, with zero firmware edits.

---

## Explored Concepts

### 1. How the Applications menu is built

`systemApp.js` owns the Applications menu. The relevant methods:

- **`_initApplicationsDataList()`** — called once on construction; builds
  `this._masterApplicationDataList.items` — the canonical list of all possible app rows. Each item
  carries an `appData` object with `appName`, `isVisible`, `audioSourceId`, and `mmuiEvent`.
- **`_updateApplicationStructure()`** — called every time the Applications screen is displayed;
  rebuilds `this._applicationsCtxtWiseAppNames` from scratch, which is the whitelist of app names
  that are actually shown in the current context (e.g. `Applications`). A row in the master list is
  only rendered if its `appName` is in this whitelist.
- **`_menuItemSelectCallback()`** — called when the user taps a row; routes the row's `mmuiEvent`
  string through `framework.sendEventToMmui()`.

To inject a custom row that persists across whitelist rebuilds, both the master list and the
whitelist method must be patched.

### 2. Client-side screen navigation (no MMUI needed)

Normally, selecting an app row sends an event to MMUI via WebSocket. MMUI processes it, decides
which context (screen) to show next, and sends a `ctxChg` + `transition` message back to the GUI.
The GUI then renders the new screen.

The rendering step is pure JavaScript. The critical call chain in `GuiFramework.js`:

```
framework._callHandleContext(ctxtObj)   // Phase A: update bookkeeping, set _currentContext
framework._transitionChange(false)       // Phase B: instantiate the template, render to DOM
```

Both functions are callable from our own code. This means a custom screen can be rendered
**entirely client-side**, without any MMUI round-trip. MMUI continues to believe the previous
context is active — we exploit this for the Back button.

### 3. Screens as context-table entries

Each app (e.g. `systemApp`) has a `_contextTable` — a plain JS object mapping `ctxtId` strings to
context descriptors:

```js
this._contextTable['MyScreen'] = {
    leftBtnStyle: 'goBack',      // shows the back arrow
    sbNameId: 'Applications',   // status bar label (can be a literal string)
    template: 'List2Tmplt',     // the template to instantiate
    controlProperties: {
        List2Ctrl: {
            dataList: { itemCountKnown: true, itemCount: N, items: [...] },
            titleConfiguration: 'noTitle',
            selectCallback: fn,
            slideCallback: fn
        }
    },
    readyFunction: fn            // called after the template is ready; used to refresh data
};
```

Adding an entry here is all that is needed to define a new screen. The stock `List2Tmplt` +
`List2Ctrl` handles rendering, scrolling, item selection, and widget interactions.

### 4. The List2 widget catalog

`List2Ctrl.js` defines a rich set of row styles via `itemStyle`:

| `itemStyle`  | Widget                              | Key fields                                             |
|--------------|-------------------------------------|--------------------------------------------------------|
| `style01`    | Navigation row + caret              | `text1`, `hasCaret`                                    |
| `styleOnOff` | On/Off switch                       | `text1`, `value` (1=off, 2=on)                         |
| `style10`    | Two-state segmented toggle          | `text1`, `button1`, `button2`, `value`                 |
| `style11`    | Three-state segmented toggle        | `text1`, `button1`–`button3`, `value`                  |
| `style12`    | Slider                              | `text1`, `min`, `max`, `increment`, `value`, `pivot`, `showTickMarks`, `tickMarkObject`, `showLabels`, `labelObject` |
| `styleStep`  | +/− stepper                         | `text1`, `label1`, `label2`, `min`, `max`, `increment`, `value` |
| `style03`    | Selectable row (radio or checkbox)  | `text1`, `image1` (`"radio"` or `"tick"`), `checked`  |
| `style06`    | Value display row                   | `text1`, `label1` (right-aligned), `hasCaret`          |
| `style04`    | Two-line row                        | `text1`, `text2`, `hasCaret`                           |

Labels are rendered as **literals** when the matching `*Id` field is `null` or absent — no
localization dictionary is needed. List2Ctrl guards every `text1Id` / `label1Id` reference with
`if (item.text1Id) {...}` before attempting a dictionary lookup.

### 5. The Back button problem

Every context registered with `leftBtnStyle: 'goBack'` wires the back arrow to send
`Global.GoBack` to MMUI via `framework.sendEventToMmui`. MMUI has no knowledge of our injected
screen, so it would navigate somewhere unexpected.

**Solution:** intercept `framework.sendEventToMmui`. When the current context is our screen and
the event is `Global.GoBack`, swallow the event and call `navigateTo('Applications')` ourselves.
MMUI's state remains on the Applications context (which is where it should be — our screen was
purely client-side), so this is consistent.

### 6. Prototype patching vs. live-instance patching

The Applications context binds `selectCallback = this._menuItemSelectCallback.bind(this)` at
**construction time**. Wrapping the prototype method after the instance is already built would have
no effect on the already-bound callback. The fix is to intercept `framework.sendEventToMmui`
instead, which is the final common path that `_menuItemSelectCallback` routes through — this works
regardless of when the patch is applied relative to instance construction.

For the menu row and whitelist, prototype wrapping is correct: `_initApplicationsDataList` runs
once at construction (handled by the prototype wrap), and `_updateApplicationStructure` runs every
time the Applications screen opens (also handled). A live-instance fallback handles the case where
the system app was already constructed before our script loaded.

### 7. The CASDK/AIO Tweaks approach (reference, not used here)

Projects like [MZD-AIO](https://github.com/Trevelopment/MZD-AIO-TI) and
[MZD Speedometer](https://github.com/Trevelopment/MZD_Speedometer) use the CASDK (Car App SDK)
framework: a purpose-built abstraction that wraps a `<webview>` / iframe in a custom HTML overlay,
communicates via the CASDK bridge, and uses installation scripts to copy files to the CMU.

That approach creates a separate rendering context (its own HTML/CSS), not a native-feeling stock
MZD screen. Our approach instead patches the running `systemApp` instance in place and uses the
stock `List2` template and control, so the app is visually indistinguishable from stock entries.

---

## Implemented Files

### `data/integration/developer_mode_GuiConfig.js`

**Purpose:** Boot hook. Injected into the GUI at startup with zero stock file edits.

**How it loads:** `jci/gui/index.html` line 33 unconditionally loads this path if it exists:
```html
<script src="../../data/integration/developer_mode_GuiConfig.js"></script>
```

**What it does:** Creates a `<script>` element pointing at `apps/helloworld/js/helloworldApp.js`
and appends it to `<head>`. That path is relative to `index.html`'s base (`jci/gui/`), resolving
to `jci/gui/apps/helloworld/js/helloworldApp.js`.

To add more custom apps, add more `<script>` injections here.

### `jci/gui/apps/helloworld/js/helloworldApp.js`

**Purpose:** Self-contained Hello World app. No stock files are modified.

**What it does at runtime:**
1. Polls every 100ms until `window.framework` and `window.systemApp` are ready (~2–3s after boot).
2. Wraps `systemApp.prototype._initApplicationsDataList` to inject the menu row.
3. Wraps `systemApp.prototype._updateApplicationStructure` to re-whitelist the app after each rebuild.
4. Wraps `framework.sendEventToMmui` to intercept the menu selection and the Back button.
5. Adds a `'HelloWorld'` entry to `_contextTable` defining the showcase screen.
6. Applies the same patches to any already-live `systemApp` instance (live-instance fallback).

**The showcase screen** (`HelloWorld` context) contains 10 rows demonstrating every major `List2`
widget: navigation row, On/Off switch, two-state toggle, three-state toggle, slider, stepper, radio
button, checkbox, value-display row, and two-line row. Widgets are interactive (toggles flip, slider
drags, stepper increments) but do not persist state.

---

## Running in the Emulator (mzd-emu)

The emulator is available at: **https://github.com/ScorpAL/mzd-emu**

It runs the MZD GUI in a desktop browser, serving the firmware files over a local Node.js HTTP
server.

### One-time setup

#### 1. Clone both repositories side by side

```bash
git clone https://github.com/ScorpAL/mzd-emu.git
# Your firmware dump should already be at mzd-custom-app/ (this repo)
```

The emulator expects to find the JCI files at `mzd-emu/jci/`. The simplest arrangement is to
symlink or copy the `jci/` directory from this repo:

```bash
ln -s /path/to/mzd-custom-app/jci /path/to/mzd-emu/jci
```

Or copy it:

```bash
cp -r /path/to/mzd-custom-app/jci /path/to/mzd-emu/jci
```

#### 2. Create the `/data/` partition directory in the emulator

The real CMU's `/data/` partition is a sibling of `/jci/`. The emulator must serve it too.

```bash
mkdir -p /path/to/mzd-emu/data/integration
```

#### 3. Copy the custom app files into the emulator tree

```bash
# Boot hook (the data partition)
cp /path/to/mzd-custom-app/data/integration/developer_mode_GuiConfig.js \
   /path/to/mzd-emu/data/integration/

# App script (inside the jci tree)
mkdir -p /path/to/mzd-emu/jci/gui/apps/helloworld/js
cp /path/to/mzd-custom-app/jci/gui/apps/helloworld/js/helloworldApp.js \
   /path/to/mzd-emu/jci/gui/apps/helloworld/js/
```

#### 4. Patch `ui-server.js` to serve `/data/`

Open `mzd-emu/server/ui-server.js` and find the `mounts` array. Add the `/data/` mount alongside
`/jci/` and `/emulator/`:

```js
mounts: [
    { prefix: '/jci/',      dir: path.join(__dirname, '..', 'jci') },
    { prefix: '/data/',     dir: path.join(__dirname, '..', 'data') },   // add this line
    { prefix: '/emulator/', dir: path.join(__dirname, '..', 'client') }
],
```

Without this mount, the browser cannot fetch `developer_mode_GuiConfig.js` and the app never loads.

#### 5. Install dependencies and start

```bash
cd /path/to/mzd-emu
npm install
npm start
```

The server opens `http://localhost:8080/jci/gui/index.html` automatically.

### Testing the Hello World app

1. Open **http://localhost:8080/jci/gui/index.html** in Chrome or Chromium.
2. Wait approximately **10 seconds** for the MZD boot sequence and disclaimer to finish.
3. Navigate to the Applications menu:
   - Press **← (left arrow)** twice — moves focus past the home carousel
   - Press **Enter** — opens the Applications menu
4. **"Hello World"** appears at the bottom of the app list, after Apple CarPlay / Android Auto.
5. Select it and press Enter. The showcase screen opens with 10 rows.
6. Interact with the widgets: toggles flip, slider drags, stepper increments.
7. Press **← (left arrow)** (Back) — returns to the Applications list.

### Keyboard to multicontroller mapping

The emulator's `Multicontroller.js` maps keyboard keys to CMU multicontroller inputs:

| Key        | Code | CMU action   |
|------------|------|--------------|
| ← Arrow    | 37   | Left / Back  |
| → Arrow    | 39   | Right        |
| ↑ Arrow    | 38   | Up           |
| ↓ Arrow    | 40   | Down         |
| Enter      | 13   | Select       |

---

## Deploying to a Real CMU

The real CMU uses USB-based installs. All that is needed is to place two files on the CMU's `/data/`
partition.

> **Prerequisite:** Root access to the CMU is required to write to `/data/`. The CMU in this repo
> already has root scripts available in `mzd74-root/` and `mzd74-root-no-touch/`. Follow those
> instructions first if the CMU is not already rooted.

### Method: USB install script

Create an install script that the CMU runs at startup (the standard AIO-style mechanism):

```bash
#!/bin/sh
# install-helloworld.sh
# Run from USB by placing in the CMU's auto-run path (see AIO-Tweaks for reference).

DATA_INTEGRATION=/data/integration
JCI_GUI_APPS=/jci/gui/apps

mkdir -p "$DATA_INTEGRATION"
mkdir -p "$JCI_GUI_APPS/helloworld/js"

cp developer_mode_GuiConfig.js "$DATA_INTEGRATION/"
cp helloworldApp.js             "$JCI_GUI_APPS/helloworld/js/"
```

Place this script alongside the two JS files on a USB drive formatted as FAT32. Use the install
mechanism from `AIO-Tweaks/` in this repo to execute it on the CMU.

### Manual install via SSH / ADB

If the CMU is accessible over SSH or ADB:

```bash
# Copy the boot hook to the data partition
scp data/integration/developer_mode_GuiConfig.js cmu@<CMU_IP>:/data/integration/

# Copy the app script to the firmware tree
ssh cmu@<CMU_IP> "mkdir -p /jci/gui/apps/helloworld/js"
scp jci/gui/apps/helloworld/js/helloworldApp.js cmu@<CMU_IP>:/jci/gui/apps/helloworld/js/
```

Restart the CMU GUI:

```bash
ssh cmu@<CMU_IP> "killall -HUP opera"   # or reboot the CMU
```

### File locations on the real CMU

| File                                              | CMU path                                         |
|---------------------------------------------------|--------------------------------------------------|
| `data/integration/developer_mode_GuiConfig.js`    | `/data/integration/developer_mode_GuiConfig.js`  |
| `jci/gui/apps/helloworld/js/helloworldApp.js`     | `/jci/gui/apps/helloworld/js/helloworldApp.js`   |

No stock files need to be modified or backed up.

---

## Extending This to Your Own App

The Hello World app is designed as a template. To create a new app:

### 1. Create a new app script

Copy `helloworldApp.js` to `jci/gui/apps/<yourapp>/js/<yourapp>App.js` and modify:

```js
var APP_NAME   = "yourapp";           // unique identifier
var MENU_EVENT = "SelectYourApp";     // unique sentinel (never reaches MMUI)
var CTXT_ID    = "YourApp";           // unique context id
var MENU_LABEL = "Your App Name";     // label shown in Applications menu
```

Update `buildShowcaseDataList()` (or rename it) to return your actual screen content.

### 2. Register the boot hook

In `developer_mode_GuiConfig.js`, add another script injection:

```js
var script2 = document.createElement("script");
script2.type = "text/javascript";
script2.src = "apps/yourapp/js/yourapApp.js";
(document.head || document.documentElement).appendChild(script2);
```

### 3. Install both files and restart

Follow the same emulator or CMU install steps above, substituting your new paths.

### Reusing other stock templates

The Hello World app uses `List2Tmplt` (a scrollable list). The MZD GUI has other templates visible
in `jci/gui/common/templates/`:

- `List1Tmplt` — simpler single-column list
- `EmptyCtrlTmplt` — blank canvas (for fully custom rendering)
- `OnDTmplt` — used by apps that display a single status screen

Each template has a corresponding control (e.g. `List1Ctrl`) with its own `controlProperties`
shape. Consult the stock app implementations in `jci/gui/apps/` for usage examples.

---

## Key Constraints and Gotchas

**MMUI state consistency.** Our screen is client-side only; MMUI still thinks the Applications
context is active. This is safe as long as we intercept Back (we do) and don't try to register
with MMUI's own context stack.

**`_updateApplicationStructure` rebuilds the whitelist every time.** The `whitelistApp` wrapper
runs after every rebuild, so the app stays visible. Do not try to patch the data structure once at
startup and assume it persists.

**`_menuItemSelectCallback` is bound at construction.** Patching the prototype method after
construction has no effect on already-bound callbacks. The `sendEventToMmui` intercept is the
correct hook point.

**Opera/Presto JS engine.** The real CMU runs Opera 3.x (Presto). Avoid ES6+ syntax (`let`,
`const`, arrow functions, template literals, `class`, destructuring). Use `var`, `function`,
and explicit prototype manipulation — exactly as the stock code does.

**No persistence.** Widget state (toggle position, slider value) is in-memory only and resets
when the screen is re-entered. To persist, write to `/data/` via XHR or the CMU's file API.

**No dictionary.** Labels set as literals (`text1: "My label"` with `text1Id: null`) bypass the
localization system entirely. If you need translated strings, consult `jci/gui/framework/i18n/`.
