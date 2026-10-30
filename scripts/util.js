"use strict";

let DEBUG = false;

function debugLog(tag, blockName, x, y, reason) {
    if (DEBUG) {
        Log.info("[AutoDrill] " + tag + ": " + blockName + " @ (" + x + "," + y + ") - " + reason);
    }
}

function isWithinWorld(block, x, y) {
    let size = block.size | 0;
    let halfLow = Math.floor((size - 1) / 2);
    let halfHigh = Math.floor(size / 2);
    let minX = (x | 0) - halfLow;
    let minY = (y | 0) - halfLow;
    let maxX = (x | 0) + halfHigh;
    let maxY = (y | 0) + halfHigh;
    return minX >= 0 && minY >= 0
        && maxX < Vars.world.width()
        && maxY < Vars.world.height();
}

function canPlaceBlock(block, team, x, y, rotation) {
    let tx = x | 0;
    let ty = y | 0;
    let rot = (rotation || 0) | 0;
    if (!isWithinWorld(block, tx, ty)) {
        debugLog("REJECT", block.name, tx, ty, "out of world bounds");
        return false;
    }
    if (!Build.validPlace(block, team, tx, ty, rot)) {
        debugLog("REJECT", block.name, tx, ty, "Mindustry Build.validPlace failed");
        return false;
    }
    return true;
}

function canPlacePlan(plan, team) {
    return canPlaceBlock(plan.block, team, plan.x, plan.y, plan.rotation);
}

function getBlockBounds(x, y, size) {
    let s = size | 0;
    let offset = Math.floor((s - 1) / 2);
    let minX = (x | 0) - offset;
    let minY = (y | 0) - offset;
    return {
        minX: minX,
        minY: minY,
        maxX: minX + s,
        maxY: minY + s
    };
}

function boundsOverlap(a, b) {
    return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
}

function footprintOverlapsPlanned(block, x, y, planned) {
    let candidate = getBlockBounds(x, y, block.size);
    for (let i = 0; i < planned.length; i++) {
        let p = planned[i];
        let existing = getBlockBounds(p.x, p.y, p.block.size);
        if (boundsOverlap(candidate, existing)) {
            debugLog("OVERLAP", block.name, x, y,
                "collides with planned " + p.block.name + " at " + p.x + "," + p.y);
            return true;
        }
    }
    return false;
}

function canPlaceWithoutPlanCollision(plan, team, planned) {
    if (!canPlacePlan(plan, team)) {
        return false;
    }
    if (footprintOverlapsPlanned(plan.block, plan.x, plan.y, planned)) {
        return false;
    }
    return true;
}

function commitPlans(plans) {
    if (Vars.player == null || Vars.player.unit() == null) return;

    let previewKey = Core.bundle.get("auto-drill.settings.mobile-preview-plans", "Preview Plans Before Building (Mobile)");
    let useMobilePreview = Vars.mobile
        && Core.settings.getBool(previewKey, false)
        && Vars.control != null
        && Vars.control.input != null
        && Vars.control.input.selectPlans != null;

    if (useMobilePreview) {
        for (let i = 0; i < plans.length; i++) {
            Vars.control.input.selectPlans.add(plans[i]);
        }
    } else {
        let unit = Vars.player.unit();
        for (let i = 0; i < plans.length; i++) {
            unit.addBuild(plans[i]);
        }
    }

    if (DEBUG) {
        Log.info("[AutoDrill] Committed " + plans.length + " build plans.");
    }
}

function getNearbyTiles(x, y, sizeOrBlock, size2) {
    let tx = x | 0;
    let ty = y | 0;
    if (size2 !== undefined) {
        let size1 = typeof sizeOrBlock === "number" ? (sizeOrBlock | 0) : (sizeOrBlock.size | 0);
        let s2 = size2 | 0;
        let offset1 = (size1 % 2 === 1 && s2 % 2 === 0) ? 1 : 0;
        let offset2 = Math.floor((s2 * 2 - 1) / 2);
        return getNearbyTiles(tx - offset1, ty - offset1, size1 + offset2);
    }

    let size = typeof sizeOrBlock === "number" ? (sizeOrBlock | 0) : (sizeOrBlock.size | 0);
    let nearbyTiles = [];
    let nearby = Edges.getEdges(size);
    for (let i = 0; i < nearby.length; i++) {
        let pt = nearby[i];
        let t = Vars.world.tile(tx + pt.x, ty + pt.y);
        if (t != null) nearbyTiles.push(t);
    }
    return nearbyTiles;
}

function countOre(tile, drill) {
    let linkedSeq = tile.getLinkedTilesAs(drill, new Seq());
    let entries = [];

    for (let i = 0; i < linkedSeq.size; i++) {
        let other = linkedSeq.get(i);
        if (drill.canMine(other)) {
            let drop = drill.getDrop(other);
            if (drop != null) {
                let found = null;
                for (let j = 0; j < entries.length; j++) {
                    if (entries[j].item === drop) {
                        found = entries[j];
                        break;
                    }
                }
                if (found != null) {
                    found.count += 1;
                } else {
                    entries.push({ item: drop, count: 1 });
                }
            }
        }
    }

    if (entries.length === 0) return null;

    entries.sort(function(a, b) {
        let aHigh = !a.item.lowPriority;
        let bHigh = !b.item.lowPriority;
        if (aHigh !== bHigh) return aHigh ? 1 : -1;
        if (a.count !== b.count) return a.count - b.count;
        return (a.item.id | 0) - (b.item.id | 0);
    });

    let best = entries[entries.length - 1];
    return {
        key: best.item,
        value: best.count
    };
}

function expandArea(tiles, radius) {
    let r = radius | 0;
    let seen = new IntSet();
    for (let i = 0; i < tiles.length; i++) {
        seen.add(tiles[i].pos());
    }

    let expanded = [];
    for (let i = 0; i < tiles.length; i++) {
        let tile = tiles[i];
        for (let dx = -r; dx < r; dx++) {
            for (let dy = -r; dy < r; dy++) {
                if (dx === 0 && dy === 0) continue;
                let nearby = tile.nearby(dx, dy);
                if (nearby == null) continue;
                let pos = nearby.pos();
                if (!seen.contains(pos)) {
                    seen.add(pos);
                    expanded.push(nearby);
                }
            }
        }
    }

    for (let i = 0; i < expanded.length; i++) {
        tiles.push(expanded[i]);
    }
    return tiles;
}

function getConnectedTiles(tile, maxTiles) {
    let limit = maxTiles | 0;
    let queue = [tile];
    let head = 0;
    let tiles = [];
    let visited = new IntSet();

    let sourceItem = tile.drop();
    let wallBlock = Blocks.copperWall.environmentBuildable() ? Blocks.copperWall : Blocks.berylliumWall;
    let team = Vars.player.team();

    while (head < queue.length && tiles.length < limit) {
        let currentTile = queue[head++];
        let pos = currentTile.pos();

        if (visited.contains(pos)) continue;
        if (!Build.validPlace(wallBlock, team, currentTile.x | 0, currentTile.y | 0, 0)) {
            continue;
        }

        if (currentTile.drop() === sourceItem) {
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    if (dx === 0 && dy === 0) continue;
                    let neighbor = currentTile.nearby(dx, dy);
                    if (neighbor == null) continue;
                    if (!visited.contains(neighbor.pos())) {
                        queue.push(neighbor);
                    }
                }
            }
            tiles.push(currentTile);
        }

        visited.add(pos);
    }

    tiles.sort(function(a, b) {
        return a.pos() - b.pos();
    });

    return tiles;
}

module.exports = {
    get DEBUG() { return DEBUG; },
    set DEBUG(v) { DEBUG = !!v; },
    isWithinWorld: isWithinWorld,
    canPlaceBlock: canPlaceBlock,
    canPlacePlan: canPlacePlan,
    getBlockBounds: getBlockBounds,
    boundsOverlap: boundsOverlap,
    footprintOverlapsPlanned: footprintOverlapsPlanned,
    canPlaceWithoutPlanCollision: canPlaceWithoutPlanCollision,
    commitPlans: commitPlans,
    getNearbyTiles: getNearbyTiles,
    countOre: countOre,
    expandArea: expandArea,
    getConnectedTiles: getConnectedTiles
};
