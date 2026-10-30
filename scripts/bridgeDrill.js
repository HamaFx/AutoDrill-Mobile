"use strict";

const Util = require("util");

function isDrillTile(tile) {
    let x = tile.x | 0;
    let y = tile.y | 0;
    let xm = ((x % 6) + 6) % 6;

    switch (xm) {
        case 0:
        case 2:
            if ((((y - 1) % 6) + 6) % 6 === 0) return true;
            break;
        case 1: {
            let ym = (((y - 3) % 6) + 6) % 6;
            if (ym === 0 || ym === 2) return true;
            break;
        }
        case 3:
        case 5:
            if ((((y - 4) % 6) + 6) % 6 === 0) return true;
            break;
        case 4: {
            let ym = ((y % 6) + 6) % 6;
            if (ym === 0 || ym === 2) return true;
            break;
        }
    }
    return false;
}

function isBridgeTile(tile) {
    let x = tile.x | 0;
    let y = tile.y | 0;
    return (x % 3 === 0) && (y % 3 === 0);
}

function findExistingBridgePartner(bridgeTile) {
    let offsets = [[3, 0], [-3, 0], [0, 3], [0, -3]];
    for (let i = 0; i < offsets.length; i++) {
        let off = offsets[i];
        let candidate = Vars.world.tile((bridgeTile.x | 0) + off[0], (bridgeTile.y | 0) + off[1]);
        if (candidate != null && candidate.build != null && candidate.block() === Blocks.itemBridge) {
            return candidate;
        }
    }
    return null;
}

function hasExistingBridgePointingAt(x, y) {
    let offsets = [[3, 0], [-3, 0], [0, 3], [0, -3]];
    for (let i = 0; i < offsets.length; i++) {
        let off = offsets[i];
        let candidate = Vars.world.tile((x | 0) + off[0], (y | 0) + off[1]);
        if (candidate != null && candidate.build != null && candidate.block() === Blocks.itemBridge) {
            return true;
        }
    }
    return false;
}

function containsTile(arr, tile) {
    let pos = tile.pos();
    for (let i = 0; i < arr.length; i++) {
        if (arr[i].pos() === pos) return true;
    }
    return false;
}

function placeDrillsAndBridges(source, tiles, drill, direction) {
    const team = Vars.player.team();
    let drillTiles = [];
    let bridgeTiles = [];

    for (let i = 0; i < tiles.length; i++) {
        let t = tiles[i];
        if (isDrillTile(t)) drillTiles.push(t);
        if (isBridgeTile(t)) bridgeTiles.push(t);
    }

    let prefix = drill === Blocks.blastDrill ? "airblast"
        : (drill === Blocks.laserDrill ? "laser"
        : (drill === Blocks.pneumaticDrill ? "pneumatic" : "mechanical"));
    let minOresPerDrill = Core.settings.getInt(prefix + "-drill-min-ores", 1);

    let validDrillTiles = [];
    let sourceDrop = source.drop();

    for (let i = 0; i < drillTiles.length; i++) {
        let t = drillTiles[i];
        let itemAndCount = Util.countOre(t, drill);
        if (itemAndCount == null || itemAndCount.key !== sourceDrop || itemAndCount.value < minOresPerDrill) {
            continue;
        }
        if (!Util.canPlaceBlock(drill, team, t.x, t.y, 0)) {
            continue;
        }

        let neighbors = Util.getNearbyTiles(t.x, t.y, drill).filter(isBridgeTile);
        let alreadyInBridgeTiles = false;
        for (let j = 0; j < neighbors.length; j++) {
            if (containsTile(bridgeTiles, neighbors[j])) {
                alreadyInBridgeTiles = true;
                break;
            }
        }
        if (alreadyInBridgeTiles) {
            validDrillTiles.push(t);
            continue;
        }

        let placeableNeighbors = neighbors.filter(function(n) {
            return Util.canPlaceBlock(Blocks.itemBridge, team, n.x, n.y, 0);
        });
        if (placeableNeighbors.length > 0) {
            for (let j = 0; j < placeableNeighbors.length; j++) {
                if (!containsTile(bridgeTiles, placeableNeighbors[j])) {
                    bridgeTiles.push(placeableNeighbors[j]);
                }
            }
            validDrillTiles.push(t);
        }
    }

    if (bridgeTiles.length === 0) return;

    let outerMost = bridgeTiles[0];
    let maxScore = direction.x === 0 ? (outerMost.y * direction.y) : (outerMost.x * direction.x);
    for (let i = 1; i < bridgeTiles.length; i++) {
        let cand = bridgeTiles[i];
        let score = direction.x === 0 ? (cand.y * direction.y) : (cand.x * direction.x);
        if (score > maxScore) {
            maxScore = score;
            outerMost = cand;
        }
    }

    let outlet = outerMost.nearby((direction.x * 3) | 0, (direction.y * 3) | 0);
    if (outlet == null) return;

    if (!containsTile(bridgeTiles, outlet)) {
        bridgeTiles.push(outlet);
    }

    let ox = outlet.worldx();
    let oy = outlet.worldy();
    const sortOx = ox;
    const sortOy = oy;
    bridgeTiles.sort(function(a, b) {
        return a.dst2(sortOx, sortOy) - b.dst2(sortOx, sortOy);
    });

    let allPlans = [];

    for (let i = 0; i < validDrillTiles.length; i++) {
        let dt = validDrillTiles[i];
        let plan = new BuildPlan(dt.x | 0, dt.y | 0, 0, drill);
        if (Util.canPlaceWithoutPlanCollision(plan, team, allPlans)) {
            allPlans.push(plan);
        }
    }

    let bridgePlans = [];
    for (let i = 0; i < bridgeTiles.length; i++) {
        let bt = bridgeTiles[i];
        let plannedPartner = null;
        for (let j = 0; j < bridgeTiles.length; j++) {
            let other = bridgeTiles[j];
            if (other !== bt && (Math.abs(other.x - bt.x) + Math.abs(other.y - bt.y) === 3)) {
                plannedPartner = other;
                break;
            }
        }

        let existingPartner = findExistingBridgePartner(bt);
        let partner = plannedPartner != null ? plannedPartner : existingPartner;

        if (bt === outlet) {
            let hasIncoming = false;
            for (let j = 0; j < bridgeTiles.length; j++) {
                let other = bridgeTiles[j];
                if (other !== outlet && (Math.abs(other.x - outlet.x) + Math.abs(other.y - outlet.y) === 3)) {
                    hasIncoming = true;
                    break;
                }
            }
            let hasExistingIncoming = findExistingBridgePartner(outlet) != null;
            if (!hasIncoming && !hasExistingIncoming) continue;

            let plan = new BuildPlan(bt.x | 0, bt.y | 0, 0, Blocks.itemBridge, new Point2(0, 0));
            if (Util.canPlaceWithoutPlanCollision(plan, team, allPlans)) {
                bridgePlans.push(plan);
            }
        } else if (partner != null) {
            let config = new Point2((partner.x - bt.x) | 0, (partner.y - bt.y) | 0);
            let plan = new BuildPlan(bt.x | 0, bt.y | 0, 0, Blocks.itemBridge, config);
            if (Util.canPlaceWithoutPlanCollision(plan, team, allPlans)) {
                bridgePlans.push(plan);
            }
        }
    }

    let changed = true;
    while (changed) {
        changed = false;
        for (let i = bridgePlans.length - 1; i >= 0; i--) {
            let bp = bridgePlans[i];
            let cfg = bp.config;

            if (cfg.x === 0 && cfg.y === 0) {
                let anyPointsHere = false;
                for (let j = 0; j < bridgePlans.length; j++) {
                    if (j === i) continue;
                    let other = bridgePlans[j];
                    let oCfg = other.config;
                    if (other.x + oCfg.x === bp.x && other.y + oCfg.y === bp.y) {
                        anyPointsHere = true;
                        break;
                    }
                }
                if (!anyPointsHere) {
                    anyPointsHere = hasExistingBridgePointingAt(bp.x, bp.y);
                }
                if (!anyPointsHere) {
                    bridgePlans.splice(i, 1);
                    changed = true;
                }
                continue;
            }

            let targetX = (bp.x + cfg.x) | 0;
            let targetY = (bp.y + cfg.y) | 0;
            let targetExists = false;
            for (let j = 0; j < bridgePlans.length; j++) {
                let other = bridgePlans[j];
                if (other.x === targetX && other.y === targetY) {
                    targetExists = true;
                    break;
                }
            }
            if (!targetExists) {
                let targetTile = Vars.world.tile(targetX, targetY);
                if (targetTile != null && targetTile.build != null && targetTile.block() === Blocks.itemBridge) {
                    targetExists = true;
                }
            }
            if (!targetExists) {
                bridgePlans.splice(i, 1);
                changed = true;
            }
        }
    }

    for (let i = 0; i < bridgePlans.length; i++) {
        allPlans.push(bridgePlans[i]);
    }

    Util.commitPlans(allPlans);
}

function fill(tile, drill, direction) {
    if ((drill.size | 0) !== 2) {
        throw new Error("Drill must have a size of 2");
    }
    let maxTilesKey = (drill === Blocks.mechanicalDrill ? "mechanical" : "pneumatic") + "-drill-max-tiles";
    let maxTiles = Core.settings.getInt(maxTilesKey, drill === Blocks.mechanicalDrill ? 200 : 150);
    let tiles = Util.getConnectedTiles(tile, maxTiles);
    Util.expandArea(tiles, Math.floor(drill.size / 2));
    placeDrillsAndBridges(tile, tiles, drill, direction);
}

module.exports = {
    fill: fill,
    isDrillTile: isDrillTile,
    isBridgeTile: isBridgeTile
};
