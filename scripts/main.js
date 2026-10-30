"use strict";

const Direction = require("direction");
const BridgeDrill = require("bridgeDrill");
const OptimizationDrill = require("optimizationDrill");
const WallDrill = require("wallDrill");

// All mutable module state lives in a single const object: in Rhino's iOS
// interpreter mode captured top-level `let`/`var` bindings leak to the parent
// scope, while a captured `const` binding does not.
const state = {
    enabled: false,
    selectedTile: null,
    directionAction: null,
    popupOpenedFrame: -1,

    selectTable: null,
    directionTable: null,
    enableButton: null,

    mechanicalDrillButton: null,
    pneumaticDrillButton: null,
    laserDrillButton: null,
    blastDrillButton: null,
    plasmaBoreButton: null,
    impactDrillButton: null,
    eruptionDrillButton: null
};

function getButtonSize() {
    return Vars.mobile ? 40 : 30;
}

// Diagnostic breadcrumbs: written to the game's log file so a crash between
// "start" and "done" pinpoints the failing step even without an error dialog.
function logStep(msg) {
    Log.info("[AutoDrill] " + msg);
}

// Runs a step so that any failure is logged and shown as an in-game error
// dialog instead of silently taking the game down.
function guard(name, fn) {
    return function(arg) {
        logStep(name + " start");
        try {
            let result = fn(arg);
            logStep(name + " done");
            return result;
        } catch (e) {
            let detail = "" + e;
            if (e != null && e.stack != null) {
                detail = detail + "\n" + e.stack;
            }
            Log.err("[AutoDrill] " + name + " FAILED: " + detail);
            try {
                Vars.ui.showException(new java.lang.RuntimeException("[AutoDrill] " + name + " failed:\n\n" + detail));
            } catch (e2) {
                Log.err("[AutoDrill] error reporting failed: " + e2);
            }
        }
    };
}

function setEnabled(val) {
    state.enabled = !!val;
    if (state.enableButton != null) {
        state.enableButton.setChecked(state.enabled);
    }
    if (!state.enabled) {
        if (state.selectTable != null) state.selectTable.visible = false;
        if (state.directionTable != null) state.directionTable.visible = false;
    }
}

function showWelcomeDialogIfNeeded() {
    if (Core.settings.getBool("auto-drill", false)) return;

    let bundle = Core.bundle;
    let baseDialog = new BaseDialog(bundle.get("auto-drill-welcome-title"));
    let t = new Table();

    let maxWidth = Math.max(Core.scene.getWidth() * 0.5, Math.min(1000, Core.scene.getWidth()));

    t.labelWrap(bundle.get("auto-drill-welcome-text")).growX().fillX().padTop(10).row();
    t.labelWrap(bundle.get("auto-drill-tutorial-text")).growX().fillX().padTop(10).row();
    t.image(new TextureRegionDrawable(Core.atlas.find("auto-drill-tutorial"))).maxWidth(maxWidth).scaling(Scaling.fit).padTop(10).get().setWidth(maxWidth);
    t.row();

    t.labelWrap(bundle.get("auto-drill-tutorial2-text")).growX().fillX().padTop(10).row();
    t.image(new TextureRegionDrawable(Core.atlas.find("auto-drill-tutorial2"))).maxWidth(maxWidth).scaling(Scaling.fit).padTop(10).get().setWidth(maxWidth);
    t.row();

    t.labelWrap(bundle.get("auto-drill-settings-text")).growX().fillX().padTop(10).row();
    t.image(new TextureRegionDrawable(Core.atlas.find("auto-drill-settings"))).maxWidth(maxWidth).scaling(Scaling.fit).padTop(10).get().setWidth(maxWidth);
    t.row();

    t.labelWrap(bundle.get("auto-drill-conclusion-text")).growX().fillX().padTop(10).row();

    let pane = new ScrollPane(t);
    baseDialog.cont.top().add(pane).growX().pad(0, 10, 0, 10).maxWidth(maxWidth);
    baseDialog.addCloseButton();
    baseDialog.show();

    Core.settings.put("auto-drill", true);
}

function registerSettings() {
    const bundle = Core.bundle;
    const strProc = new SettingsMenuDialog.StringProcessor({
        get: function(i) {
            return i + "";
        }
    });

    let builder = cons(function(settingsTable) {
        settingsTable.clear();
        const subTables = [];

        function addDesc(text) {
            settingsTable.labelWrap(text).fillX().padTop(6).get().setWrap(true);
            settingsTable.row();
        }

        function addDivider() {
            settingsTable.image().growX().pad(10, 0, 10, 0).color(Pal.gray);
            settingsTable.row();
        }

        function stripResetButton(sub) {
            if (sub.getChildren().size > 0) {
                sub.getChildren().peek().remove();
            }
        }

        function addSubGroup(populateFn) {
            let sub = new SettingsMenuDialog.SettingsTable();
            populateFn(sub);
            stripResetButton(sub);
            subTables.push(sub);
            settingsTable.add(sub).left().fillX().row();
        }

        addDesc(bundle.get("auto-drill.settings.activation-desc"));
        addSubGroup(function(sub) {
            const keyPrefName = bundle.get("auto-drill.settings.activation-key");
            sub.textPref(keyPrefName, "H", cons(function(s) {
                let allKeys = KeyCode.values();
                let matched = null;
                for (let i = 0; i < allKeys.length; i++) {
                    if (allKeys[i].value != null && String(allKeys[i].value).toLowerCase() === String(s).toLowerCase()) {
                        matched = allKeys[i];
                        break;
                    }
                }
                Core.settings.put(keyPrefName, matched == null ? "H" : String(matched.name()).toUpperCase());
            }));
            sub.checkPref(bundle.get("auto-drill.settings.display-toggle-button"), true);
            sub.checkPref(bundle.get("auto-drill.settings.mobile-preview-plans", "Preview Plans Before Building (Mobile)"), false);
        });

        addDivider();
        addDesc(bundle.get("auto-drill.settings.drills-desc"));

        addDesc("\uF870 " + bundle.get("auto-drill.settings.mechanical-drill"));
        addSubGroup(function(sub) {
            sub.sliderPref("mechanical-drill-max-tiles", 200, 25, 500, 25, strProc).title = bundle.get("auto-drill.settings.max-tiles");
            sub.sliderPref("mechanical-drill-min-ores", 1, 1, 4, 1, strProc).title = bundle.get("auto-drill.settings.min-ores");
        });

        addDesc("\uF86F " + bundle.get("auto-drill.settings.pneumatic-drill"));
        addSubGroup(function(sub) {
            sub.sliderPref("pneumatic-drill-max-tiles", 150, 25, 500, 25, strProc).title = bundle.get("auto-drill.settings.max-tiles");
            sub.sliderPref("pneumatic-drill-min-ores", 2, 1, 4, 1, strProc).title = bundle.get("auto-drill.settings.min-ores");
        });

        addDesc("\uF86E " + bundle.get("auto-drill.settings.laser-drill"));
        addSubGroup(function(sub) {
            sub.sliderPref("laser-drill-max-tiles", 100, 25, 500, 25, strProc).title = bundle.get("auto-drill.settings.max-tiles");
            sub.sliderPref("laser-drill-min-ores", 5, 1, 9, 1, strProc).title = bundle.get("auto-drill.settings.min-ores");
        });

        addDesc("\uF86D " + bundle.get("auto-drill.settings.airblast-drill"));
        addSubGroup(function(sub) {
            sub.sliderPref("airblast-drill-max-tiles", 100, 25, 500, 25, strProc).title = bundle.get("auto-drill.settings.max-tiles");
            sub.sliderPref("airblast-drill-min-ores", 9, 1, 16, 1, strProc).title = bundle.get("auto-drill.settings.min-ores");
        });

        addDivider();
        addDesc(bundle.get("auto-drill.settings.optimization-quality-desc"));
        addSubGroup(function(sub) {
            sub.sliderPref(bundle.get("auto-drill.settings.optimization-quality"), 2, 1, 10, 1, strProc);
            sub.checkPref(bundle.get("auto-drill.settings.place-water-extractor-and-power-nodes"), true);
            sub.checkPref(bundle.get("auto-drill.settings.place-conveyor-routing"), true);
        });

        settingsTable.button(bundle.get("settings.reset", "Reset to Defaults"), run(function() {
            for (let i = 0; i < subTables.length; i++) {
                let sub = subTables[i];
                let list = sub.getSettings();
                for (let j = 0; j < list.size; j++) {
                    let setting = list.get(j);
                    if (setting.name != null && setting.title != null) {
                        Core.settings.remove(setting.name);
                    }
                }
                sub.rebuild();
                stripResetButton(sub);
            }
        })).margin(14).width(240).pad(6);
    });

    Vars.ui.settings.addCategory(
        bundle.get("auto-drill.settings.title"),
        new TextureRegionDrawable(Core.atlas.find("auto-drill-logo")),
        builder
    );
}

function buildSelectTable() {
    let bSize = getButtonSize();
    state.selectTable = new Table(Styles.black3);

    state.selectTable.update(run(function() {
        if (Vars.state.isMenu() || state.selectedTile == null) {
            state.selectTable.visible = false;
            return;
        }
        if (state.selectTable.visible
            && Core.graphics.getFrameId() > state.popupOpenedFrame
            && Core.input.justTouched()
            && !state.selectTable.hasMouse()) {
            state.selectTable.visible = false;
            return;
        }
        let v = Core.camera.project(state.selectedTile.centerX() * Vars.tilesize, (state.selectedTile.centerY() + 1) * Vars.tilesize);
        state.selectTable.setPosition(v.x, v.y, Align.bottom);
    }));

    state.mechanicalDrillButton = state.selectTable.button(
        new TextureRegionDrawable(Core.atlas.find("block-mechanical-drill-full")),
        Styles.defaulti,
        run(guard("mechanical button", function() {
            setEnabled(false);
            state.directionTable.visible = true;
            state.popupOpenedFrame = Core.graphics.getFrameId();
            state.directionAction = guard("mechanical fill", function(dir) {
                BridgeDrill.fill(state.selectedTile, Blocks.mechanicalDrill, dir);
            });
        }))
    ).get();
    state.mechanicalDrillButton.resizeImage(bSize);

    state.pneumaticDrillButton = state.selectTable.button(
        new TextureRegionDrawable(Core.atlas.find("block-pneumatic-drill-full")),
        Styles.defaulti,
        run(guard("pneumatic button", function() {
            setEnabled(false);
            state.directionTable.visible = true;
            state.popupOpenedFrame = Core.graphics.getFrameId();
            state.directionAction = guard("pneumatic fill", function(dir) {
                BridgeDrill.fill(state.selectedTile, Blocks.pneumaticDrill, dir);
            });
        }))
    ).get();
    state.pneumaticDrillButton.resizeImage(bSize);

    state.laserDrillButton = state.selectTable.button(
        new TextureRegionDrawable(Core.atlas.find("block-laser-drill-full")),
        Styles.defaulti,
        run(guard("laser fill", function() {
            setEnabled(false);
            OptimizationDrill.fill(state.selectedTile, Blocks.laserDrill);
        }))
    ).get();
    state.laserDrillButton.resizeImage(bSize);

    state.blastDrillButton = state.selectTable.button(
        new TextureRegionDrawable(Core.atlas.find("block-blast-drill-full")),
        Styles.defaulti,
        run(guard("blast fill", function() {
            setEnabled(false);
            OptimizationDrill.fill(state.selectedTile, Blocks.blastDrill);
        }))
    ).get();
    state.blastDrillButton.resizeImage(bSize);

    state.plasmaBoreButton = state.selectTable.button(
        new TextureRegionDrawable(Core.atlas.find("block-plasma-bore-full")),
        Styles.defaulti,
        run(guard("plasma button", function() {
            setEnabled(false);
            state.directionTable.visible = true;
            state.popupOpenedFrame = Core.graphics.getFrameId();
            state.directionAction = guard("plasma fill", function(dir) {
                WallDrill.fill(state.selectedTile, Blocks.plasmaBore, dir);
            });
        }))
    ).get();
    state.plasmaBoreButton.resizeImage(bSize);

    state.impactDrillButton = state.selectTable.button(
        new TextureRegionDrawable(Core.atlas.find("block-impact-drill-full")),
        Styles.defaulti,
        run(guard("impact fill", function() {
            setEnabled(false);
            OptimizationDrill.fill(state.selectedTile, Blocks.impactDrill, false);
        }))
    ).get();
    state.impactDrillButton.resizeImage(bSize);

    state.eruptionDrillButton = state.selectTable.button(
        new TextureRegionDrawable(Core.atlas.find("block-eruption-drill-full")),
        Styles.defaulti,
        run(guard("eruption fill", function() {
            setEnabled(false);
            OptimizationDrill.fill(state.selectedTile, Blocks.eruptionDrill, false);
        }))
    ).get();
    state.eruptionDrillButton.resizeImage(bSize);

    state.selectTable.pack();
    state.selectTable.act(0);
    Core.scene.root.addChildAt(0, state.selectTable);
}

function updateSelectTable() {
    if (state.selectedTile == null) return;
    let bSize = getButtonSize();
    let cellSize = bSize + 14;

    state.selectTable.clearChildren();

    if (Blocks.mechanicalDrill.environmentBuildable() && Blocks.mechanicalDrill.canMine(state.selectedTile)) {
        state.selectTable.add(state.mechanicalDrillButton).size(cellSize);
    }
    if (Blocks.pneumaticDrill.environmentBuildable() && Blocks.pneumaticDrill.canMine(state.selectedTile)) {
        state.selectTable.add(state.pneumaticDrillButton).size(cellSize);
    }
    if (Blocks.laserDrill.environmentBuildable() && Blocks.laserDrill.canMine(state.selectedTile)) {
        state.selectTable.add(state.laserDrillButton).size(cellSize);
    }
    if (Blocks.blastDrill.environmentBuildable() && Blocks.blastDrill.canMine(state.selectedTile)) {
        state.selectTable.add(state.blastDrillButton).size(cellSize);
    }
    if (Blocks.plasmaBore.environmentBuildable()
        && state.selectedTile.wallDrop() != null
        && state.selectedTile.wallDrop().hardness <= Blocks.plasmaBore.tier) {
        state.selectTable.add(state.plasmaBoreButton).size(cellSize);
    }
    if (Blocks.impactDrill.environmentBuildable() && Blocks.impactDrill.canMine(state.selectedTile)) {
        state.selectTable.add(state.impactDrillButton).size(cellSize);
    }
    if (Blocks.eruptionDrill.environmentBuildable() && Blocks.eruptionDrill.canMine(state.selectedTile)) {
        state.selectTable.add(state.eruptionDrillButton).size(cellSize);
    }

    state.selectTable.pack();
}

function buildDirectionTable() {
    let bSize = getButtonSize();
    let cellSize = bSize + 14;
    state.directionTable = new Table(Styles.black3);

    state.directionTable.update(run(function() {
        if (Vars.state.isMenu() || state.selectedTile == null) {
            state.directionTable.visible = false;
            return;
        }
        if (state.directionTable.visible
            && Core.graphics.getFrameId() > state.popupOpenedFrame
            && Core.input.justTouched()
            && !state.directionTable.hasMouse()) {
            state.directionTable.visible = false;
            return;
        }
        let v = Core.camera.project(state.selectedTile.centerX() * Vars.tilesize, (state.selectedTile.centerY() + 1) * Vars.tilesize);
        state.directionTable.setPosition(v.x, v.y, Align.bottom);
    }));

    let row1 = state.directionTable.table().get();
    row1.button(Icon.up, Styles.defaulti, run(function() {
        if (state.directionAction != null) state.directionAction(Direction.UP);
        state.directionTable.visible = false;
    })).size(cellSize).get().resizeImage(bSize);

    state.directionTable.row();

    let row2 = state.directionTable.table().get();
    row2.button(Icon.left, Styles.defaulti, run(function() {
        if (state.directionAction != null) state.directionAction(Direction.LEFT);
        state.directionTable.visible = false;
    })).size(cellSize).get().resizeImage(bSize);

    row2.button(Icon.cancel, Styles.defaulti, run(function() {
        state.directionTable.visible = false;
    })).size(cellSize).get().resizeImage(bSize);

    row2.button(Icon.right, Styles.defaulti, run(function() {
        if (state.directionAction != null) state.directionAction(Direction.RIGHT);
        state.directionTable.visible = false;
    })).size(cellSize).get().resizeImage(bSize);

    state.directionTable.row();

    let row3 = state.directionTable.table().get();
    row3.button(Icon.down, Styles.defaulti, run(function() {
        if (state.directionAction != null) state.directionAction(Direction.DOWN);
        state.directionTable.visible = false;
    })).size(cellSize).get().resizeImage(bSize);

    state.directionTable.pack();
    state.directionTable.act(0);
    Core.scene.root.addChildAt(0, state.directionTable);
}

function initAutoDrill() {
    showWelcomeDialogIfNeeded();
    buildSelectTable();
    buildDirectionTable();
    registerSettings();

    // Keyboard activation polling (PC & iPad Hardware Keyboard)
    Events.run(Trigger.update, run(function() {
        if (Vars.state.isMenu()
            || Vars.ui.chatfrag.shown()
            || Vars.ui.schematics.isShown()
            || Vars.ui.database.isShown()
            || Vars.ui.consolefrag.shown()
            || Vars.ui.content.isShown()
            || Core.scene.hasKeyboard()) {
            return;
        }

        let keySetting = Core.settings.getString(Core.bundle.get("auto-drill.settings.activation-key"), "H");
        let allKeys = KeyCode.values();
        for (let i = 0; i < allKeys.length; i++) {
            let k = allKeys[i];
            if (k.value != null && String(k.value).toLowerCase() === String(keySetting).toLowerCase()) {
                if (Core.input.keyTap(k)) {
                    setEnabled(!state.enabled);
                }
                break;
            }
        }
    }));

    // Tile tap handler
    Events.on(TapEvent, cons(guard("tap", function(event) {
        if (!state.enabled || event.player !== Vars.player || event.tile == null) return;

        state.selectedTile = event.tile;
        updateSelectTable();

        if (state.selectTable.getChildren().size === 0) {
            return;
        }

        state.directionTable.visible = false;
        state.selectTable.visible = true;
        state.popupOpenedFrame = Core.graphics.getFrameId();

        let v = Core.camera.project(state.selectedTile.centerX() * Vars.tilesize, (state.selectedTile.centerY() + 1) * Vars.tilesize);
        state.selectTable.setPosition(v.x, v.y, Align.bottom);
        state.directionTable.setPosition(v.x, v.y, Align.bottom);

        Fx.tapBlock.at(state.selectedTile.getX(), state.selectedTile.getY());

        if (Vars.mobile && Vars.player != null && Vars.player.unit() != null) {
            Core.app.post(run(function() {
                if (Vars.player != null && Vars.player.unit() != null) {
                    Vars.player.unit().mineTile = null;
                }
            }));
        }
    })));

    // HUD Toggle Button
    const bSize = getButtonSize();
    Vars.ui.hudGroup.fill(cons(function(t) {
        state.enableButton = t.button(
            new TextureRegionDrawable(Core.atlas.find("auto-drill-logo")),
            Styles.emptyTogglei,
            run(guard("toggle button", function() {
                setEnabled(!state.enabled);
            }))
        ).size(bSize + 12).get();
        state.enableButton.resizeImage(bSize);
        // Element.visible is a public boolean field that shadows the visible(Boolp)
        // method in Rhino, so the dynamic visibility goes through the visibility field.
        state.enableButton.visibility = boolp(function() {
            return Core.settings.getBool(Core.bundle.get("auto-drill.settings.display-toggle-button"), true);
        });

        t.margin(5);
        t.marginRight(155);
        t.top().right();
    }));
}

Events.on(ClientLoadEvent, cons(function() {
    initAutoDrill();
}));
