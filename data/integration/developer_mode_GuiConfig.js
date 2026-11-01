/*
 * Boot hook for custom GUI additions (Mazda MZD v74 JCI).
 *
 * index.html loads "../../data/integration/developer_mode_GuiConfig.js" ONLY if it exists, so simply
 * dropping this file in place runs it at boot WITHOUT editing any stock file. This runs very early
 * (before the framework is built), so we don't touch the framework here - we just inject the custom
 * app's own script, which defers its work until the framework is ready.
 *
 * The path is relative to index.html (jci/gui/), so it points at jci/gui/apps/helloworld/js/.
 *
 * (The stock purpose of this filename is to enable developer mode via guiConfig._setDeveloperMode(true).
 *  That is intentionally NOT enabled here. To also enable developer mode, uncomment the line below.)
 */
(function () {
    try {
        // if (typeof guiConfig !== "undefined" && guiConfig) { guiConfig._setDeveloperMode(true); }

        var script = document.createElement("script");
        script.type = "text/javascript";
        script.src = "apps/helloworld/js/helloworldApp.js";
        var parent = document.head || document.getElementsByTagName("head")[0] || document.documentElement;
        parent.appendChild(script);
    } catch (e) {
        if (typeof log !== "undefined" && log && log.error) {
            log.error("[helloworld] boot hook failed to load app script: " + e);
        }
    }
})();
