"use strict";

const Util = require("util");

function getDrillSettingsPrefix(drill) {
    if (drill === Blocks.mechanicalDrill) return "mechanical";
    if (drill === Blocks.pneumaticDrill)  return "pneumatic";
    if (drill === Blocks.laserDrill)      return "laser";
    if (drill === Blocks.blastDrill)      return "airblast";
    if (drill === Blocks.impactDrill)     return "airblast";
    if (drill === Blocks.eruptionDrill)   return "airblast";
    return "airblast";
}

function recursiveMaxSearch(candidates, selection, sum, triesPerLevel, maxTries, level) {
    let max = sum;
    let maxSelection = selection.slice();

    while (triesPerLevel.length <= level) {
        triesPerLevel.push(0);
    }

    let levelLimit = maxTries / Math.pow(2, level + 1);

    for (let i = 0; i < candidates.length; i++) {
        let cand = candidates[i];

        let overlaps = false;
        for (let j = 0; j < selection.length; j++) {
            if (Util.boundsOverlap(cand.bounds, selection[j].bounds)) {
                overlaps = true;
                break;
            }
        }

        if (!overlaps) {
            let newSum = sum + cand.count;
            let newSelection = selection.slice();
            newSelection.push(cand);

            let newMax = recursiveMaxSearch(
                candidates,
                newSelection,
                newSum,
                triesPerLevel,
                maxTries,
                level + 1
            );

            if (newMax > max) {
                max = newMax;
                maxSelection = newSelection;
            }

            triesPerLevel[level] += 1;
            if (triesPerLevel[level] >= levelLimit) {
                break;
            }
        }
    }

    selection.length = 0;
    for (let i = 0; i < maxSelection.length; i++) {
        selection.push(maxSelection[i]);
    }

    return max;
}

function placeWaterExtractorsAndPowerNodes(selection, drill, team, allPlans) {
    let drillSize = drill.size | 0;
    let weSize = Blocks.waterExtractor.size | 0;
    let pnSize = Blocks.powerNode.size | 0;

    for (let i = 0; i < selection.length; i++) {
        let t = selection[i].tile;
        let nearby = Util.getNearbyTiles(t.x, t.y, drillSize, weSize);
        for (let j = 0; j < nearby.length; j++) {
            let n = nearby[j];
            let plan = new BuildPlan(n.x | 0, n.y | 0, 0, Blocks.waterExtractor);
            if (Util.canPlaceWithoutPlanCollision(plan, team, allPlans)) {
                allPlans.push(plan);
                break;
            }
        }
    }

    for (let i = 0; i < selection.length; i++) {
        let t = selection[i].tile;
        let nearby = Util.getNearbyTiles(t.x, t.y, drillSize, pnSize);
        for (let j = 0; j < nearby.length; j++) {
            let n = nearby[j];
            let plan = new BuildPlan(n.x | 0, n.y | 0, 0, Blocks.powerNode);
            if (Util.canPlaceWithoutPlanCollision(plan, team, allPlans)) {
                allPlans.push(plan);
                break;
            }
        }
    }
}

function fill(tile, drill, waterExtractorsAndPowerNodes) {
    if (waterExtractorsAndPowerNodes === undefined) {
        waterExtractorsAndPowerNodes = true;
    }

    let team = Vars.player.team();
    let drillPrefix = getDrillSettingsPrefix(drill);
    let maxTiles = Core.settings.getInt(drillPrefix + "-drill-max-tiles", 100);
    let minOresPerDrill = Core.settings.getInt(drillPrefix + "-drill-min-ores", 5);

    let tiles = Util.getConnectedTiles(tile, maxTiles);
    Util.expandArea(tiles, Math.floor(drill.size / 2));

    let floor = tile.overlay() !== Blocks.air ? tile.overlay() : tile.floor();
    let targetDrop = floor.itemDrop;
    let drillSize = drill.size | 0;

    let candidates = [];
    for (let i = 0; i < tiles.length; i++) {
        let t = tiles[i];
        let itemAndCount = Util.countOre(t, drill);
        if (itemAndCount == null || itemAndCount.key !== targetDrop || itemAndCount.value < minOresPerDrill) {
            continue;
        }
        if (!Util.canPlaceBlock(drill, team, t.x, t.y, 0)) {
            continue;
        }
        candidates.push({
            tile: t,
            count: itemAndCount.value,
            bounds: Util.getBlockBounds(t.x, t.y, drillSize)
        });
    }

    candidates.sort(function(a, b) {
        return b.count - a.count;
    });

    let optKey = Core.bundle.get("auto-drill.settings.optimization-quality");
    let maxTries = Core.settings.getInt(optKey, 2) * 1000;

    let selection = [];
    recursiveMaxSearch(candidates, selection, 0, [], maxTries, 0);

    let allPlans = [];
    for (let i = 0; i < selection.length; i++) {
        let t = selection[i].tile;
        let plan = new BuildPlan(t.x | 0, t.y | 0, 0, drill);
        if (Util.canPlaceWithoutPlanCollision(plan, team, allPlans)) {
            allPlans.push(plan);
        }
    }

    let placeSupportKey = Core.bundle.get("auto-drill.settings.place-water-extractor-and-power-nodes");
    if (waterExtractorsAndPowerNodes && Core.settings.getBool(placeSupportKey, true)) {
        placeWaterExtractorsAndPowerNodes(selection, drill, team, allPlans);
    }

    Util.commitPlans(allPlans);
}

module.exports = {
    fill: fill,
    recursiveMaxSearch: recursiveMaxSearch
};
