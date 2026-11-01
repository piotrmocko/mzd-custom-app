/*
 * Hello World - a self-contained demo app for the Mazda MZD v74 JCI GUI.
 *
 * This file is loaded additively at boot (via jci/data/integration/developer_mode_GuiConfig.js)
 * and does NOT modify any stock file. At runtime it:
 *   1. injects a "Hello World" row into the stock Applications menu,
 *   2. adds a new "HelloWorld" screen (context) to the system app, rendered with the stock
 *      List2 template + control, showcasing 10 different stock UI components,
 *   3. launches that screen client-side when the row is tapped (no MMUI round-trip needed), and
 *   4. intercepts the stock Back button so it returns to the Applications list.
 *
 * Everything is done by wrapping prototype / framework methods at runtime. Nothing stock is edited.
 */
(function () {
    "use strict";

    var APP_NAME   = "helloworld";        // appData.appName used for the menu row + whitelist
    var MENU_EVENT = "SelectHelloWorld";  // sentinel event our row carries (never reaches MMUI)
    var CTXT_ID    = "HelloWorld";        // our screen's context id on the system app
    var MENU_LABEL = "Hello World";       // literal label shown in the Applications menu

    function logErr(msg) {
        if (typeof log !== "undefined" && log && log.error) {
            log.error("[helloworld] " + msg);
        }
    }

    // ------------------------------------------------------------------
    // The showcase screen's data: 10 rows, each a different stock widget.
    // Every label is set as a literal (text1 / label1 / button1 ...) with the matching *Id left
    // undefined, so List2Ctrl renders it verbatim without any dictionary lookup.
    // ------------------------------------------------------------------
    function buildShowcaseDataList() {
        var sliderTicks  = { tickIncrement: 1, showCenterMark: true, showNumbers: false };
        var sliderLabels = { leftLabelText: "-", centerLabelText: "0", rightLabelText: "+" };

        var items = [
            // 1. plain navigation row (text + caret)
            { itemStyle: "style01",   appData: "hw_nav",     hasCaret: true,  text1: "Navigation row" },
            // 2. On/Off switch (value: 1 = off, 2 = on)
            { itemStyle: "styleOnOff", appData: "hw_onoff",  hasCaret: false, text1: "On / Off switch", value: 2 },
            // 3. two-state segmented toggle
            { itemStyle: "style10",   appData: "hw_toggle2", hasCaret: false, text1: "Two-state toggle", button1: "Auto", button2: "Manual", value: 1 },
            // 4. three-way segmented toggle
            { itemStyle: "style11",   appData: "hw_toggle3", hasCaret: false, text1: "Three-way toggle", button1: "High", button2: "Low", button3: "Off", value: 1 },
            // 5. slider (center-zero, tick marks + -/0/+ labels)
            { itemStyle: "style12",   appData: "hw_slider",  hasCaret: false, text1: "Slider", pivot: true, min: -6, max: 6, increment: 1, value: 0, showTickMarks: true, tickMarkObject: sliderTicks, showLabels: true, labelObject: sliderLabels },
            // 6. +/- stepper
            { itemStyle: "styleStep", appData: "hw_step",    hasCaret: false, text1: "Stepper", label1: "Value", label2: "5", min: 0, max: 10, increment: 1, value: 5 },
            // 7. radio selection
            { itemStyle: "style03",   appData: "hw_radio",   hasCaret: false, text1: "Radio option", image1: "radio", checked: true },
            // 8. checkbox selection
            { itemStyle: "style03",   appData: "hw_check",   hasCaret: false, text1: "Checkbox option", image1: "tick", checked: false },
            // 9. value-display row (right label + drill-in caret)
            { itemStyle: "style06",   appData: "hw_value",   hasCaret: true,  text1: "Value display", label1: "Normal" },
            // 10. two-line row (title + subtitle)
            { itemStyle: "style04",   appData: "hw_twoline", hasCaret: true,  text1: "Two line row", text2: "Secondary text" }
        ];

        return { itemCountKnown: true, itemCount: items.length, items: items };
    }

    // Tap/slide handlers. The List2 control already updates its own widget visuals (toggles flip,
    // sliders drag, steppers increment); these callbacks exist only so the control has something to
    // call. They intentionally do nothing else - this is a component showcase.
    function onItemSelect(/* listCtrlObj, appData, params */) {
        return true;
    }
    function onItemSlide(/* listCtrlObj, appData, params */) {
        return true;
    }

    // ------------------------------------------------------------------
    // Runtime injection helpers (operate on a given system app instance / prototype `this`).
    // ------------------------------------------------------------------

    // Add our row to the master Applications data list (idempotent).
    function addMenuRow(sysInstance) {
        var master = sysInstance._masterApplicationDataList;
        if (!master || !master.items) {
            return;
        }
        for (var i = 0; i < master.items.length; ++i) {
            if (master.items[i].appData && master.items[i].appData.appName === APP_NAME) {
                return; // already added
            }
        }
        master.items.push({
            appData: { appName: APP_NAME, isVisible: true, audioSourceId: "None", mmuiEvent: MENU_EVENT },
            text1Id: null,
            text1: MENU_LABEL,
            disabled: false,
            itemStyle: "style01",
            hasCaret: true
        });
    }

    // Ensure our appName is whitelisted for the Applications context (idempotent).
    // _updateApplicationStructure rebuilds this map from scratch, so this must run after it.
    function whitelistApp(sysInstance) {
        var map = sysInstance._applicationsCtxtWiseAppNames;
        if (!map || !map.Applications) {
            return;
        }
        if (map.Applications.indexOf(APP_NAME) === -1) {
            map.Applications.push(APP_NAME);
        }
    }

    // Add our screen's context-table entry (idempotent).
    function ensureContext(sysInstance) {
        if (!sysInstance._contextTable || sysInstance._contextTable[CTXT_ID]) {
            return;
        }
        sysInstance._contextTable[CTXT_ID] = {
            leftBtnStyle: "goBack",
            sbNameId: "Applications",
            template: "List2Tmplt",
            controlProperties: {
                List2Ctrl: {
                    dataList: buildShowcaseDataList(),
                    titleConfiguration: "noTitle",
                    numberedList: false,
                    selectCallback: onItemSelect,
                    slideCallback: onItemSlide
                }
            },
            readyFunction: function () {
                // Mirror the stock pattern: (re)seat the data list when the screen is shown.
                if (this._currentContext && this._currentContextTemplate && this._currentContextTemplate.list2Ctrl) {
                    var dataList = buildShowcaseDataList();
                    this._currentContextTemplate.list2Ctrl.setDataList(dataList);
                    this._currentContextTemplate.list2Ctrl.updateItems(0, dataList.items.length - 1);
                }
            }
        };
    }

    // Drive a client-side navigation to one of the system app's contexts, replicating the two
    // messages MMUI would normally send (context change + transition). The system app is already
    // the focused app while the Applications menu is open, so no focus-stack manipulation is needed.
    function navigateTo(ctxtId) {
        try {
            var seq = (typeof framework.getCurrCtxtSeqNo === "function" ? framework.getCurrCtxtSeqNo() : 0) + 1;
            framework._callHandleContext({ uiaId: "system", ctxtId: ctxtId, params: {}, contextSeq: seq });
            framework._transitionChange(false);
        } catch (e) {
            logErr("navigateTo(" + ctxtId + ") failed: " + e);
        }
    }

    // ------------------------------------------------------------------
    // Installers.
    // ------------------------------------------------------------------

    var _protoPatched = false;
    function patchSystemAppPrototype() {
        if (_protoPatched) {
            return;
        }
        var proto = window.systemApp.prototype;

        var origInit = proto._initApplicationsDataList;
        proto._initApplicationsDataList = function () {
            origInit.apply(this, arguments);
            addMenuRow(this);
        };

        var origStruct = proto._updateApplicationStructure;
        proto._updateApplicationStructure = function () {
            origStruct.apply(this, arguments);
            whitelistApp(this);
        };

        _protoPatched = true;
    }

    // Intercept framework.sendEventToMmui. The stock _menuItemSelectCallback routes a tapped row's
    // mmuiEvent through here, so catching MENU_EVENT launches our screen regardless of whether the
    // menu's select callback was bound before or after we loaded. We also catch Global.GoBack while
    // our screen is showing, to handle Back ourselves (MMUI has no record of our injected context).
    var _sendPatched = false;
    function patchFrameworkSend() {
        if (_sendPatched || typeof framework.sendEventToMmui !== "function") {
            return;
        }
        var origSend = framework.sendEventToMmui;
        framework.sendEventToMmui = function (uiaId, eventId) {
            try {
                if (eventId === MENU_EVENT) {
                    var inst = (typeof framework.getAppInstance === "function") ? framework.getAppInstance("system") : null;
                    if (inst) {
                        ensureContext(inst);
                    }
                    navigateTo(CTXT_ID);
                    return;
                }
                if (eventId === "Global.GoBack"
                    && framework._currTmpltInstance
                    && framework._currTmpltInstance.contextInfo
                    && framework._currTmpltInstance.contextInfo.ctxtId === CTXT_ID) {
                    // Re-render the Applications list (still MMUI's believed context).
                    navigateTo("Applications");
                    return;
                }
            } catch (e) {
                logErr("sendEventToMmui intercept failed: " + e);
            }
            return origSend.apply(this, arguments);
        };
        _sendPatched = true;
    }

    // If the system app instance already exists when we load, apply our additions to it directly and
    // refresh the Applications list if it happens to be on screen.
    function patchLiveInstance() {
        var inst = (typeof framework.getAppInstance === "function") ? framework.getAppInstance("system") : null;
        if (!inst) {
            return;
        }
        addMenuRow(inst);
        whitelistApp(inst);
        ensureContext(inst);
        if (inst._currentContext && inst._currentContext.ctxtId === "Applications"
            && inst._currentContextTemplate && inst._currentContextTemplate.list2Ctrl
            && typeof inst._buildApplicationsDataList === "function") {
            var dataList = inst._buildApplicationsDataList();
            inst._currentContextTemplate.list2Ctrl.setDataList(dataList);
            inst._currentContextTemplate.list2Ctrl.updateItems(0, dataList.items.length - 1);
        }
    }

    // ------------------------------------------------------------------
    // Bootstrap: wait until the framework and the systemApp constructor exist, then install.
    // ------------------------------------------------------------------
    function tryInstall() {
        if (typeof window.framework === "undefined" || !window.framework) {
            return false;
        }
        if (typeof window.systemApp !== "function") {
            return false;
        }
        patchSystemAppPrototype();
        patchFrameworkSend();
        patchLiveInstance();
        return true;
    }

    if (!tryInstall()) {
        var attempts = 0;
        var timer = setInterval(function () {
            attempts++;
            if (tryInstall() || attempts > 600) { // give up after ~60s
                clearInterval(timer);
            }
        }, 100);
    }
})();
