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

function routeFlood(free, dist, w, h, sx, sy) {
    let z = 0;
    for (z = 0; z < w * h; z++) dist[z] = -1;
    let queue = [sy * w + sx];
    let head = 0;
    dist[queue[0]] = 0;
    while (head < queue.length) {
        let cur = queue[head++];
        let gx = cur % w;
        let gy = (cur - gx) / w;
        let nd = dist[cur] + 1;
        if (gx + 1 < w && free[cur + 1] === 1 && dist[cur + 1] === -1) { dist[cur + 1] = nd; queue.push(cur + 1); }
        if (gy + 1 < h && free[cur + w] === 1 && dist[cur + w] === -1) { dist[cur + w] = nd; queue.push(cur + w); }
        if (gx - 1 >= 0 && free[cur - 1] === 1 && dist[cur - 1] === -1) { dist[cur - 1] = nd; queue.push(cur - 1); }
        if (gy - 1 >= 0 && free[cur - w] === 1 && dist[cur - w] === -1) { dist[cur - w] = nd; queue.push(cur - w); }
    }
}

function placeConveyorRouting(selection, team, allPlans) {
    if (selection.length === 0) return;

    let belt = Blocks.duct.environmentBuildable() ? Blocks.duct : Blocks.conveyor;

    // bounding box of every drill footprint, plus a margin so belts can reach open ground
    let minX = 0;
    let minY = 0;
    let maxX = 0;
    let maxY = 0;
    for (let i = 0; i < selection.length; i++) {
        let b = selection[i].bounds;
        if (i === 0) {
            minX = b.minX;
            minY = b.minY;
            maxX = b.maxX - 1;
            maxY = b.maxY - 1;
        } else {
            if (b.minX < minX) minX = b.minX;
            if (b.minY < minY) minY = b.minY;
            if (b.maxX - 1 > maxX) maxX = b.maxX - 1;
            if (b.maxY - 1 > maxY) maxY = b.maxY - 1;
        }
    }

    let margin = 2;
    let x0 = minX - margin;
    let y0 = minY - margin;
    let x1 = maxX + margin;
    let y1 = maxY + margin;
    let w = x1 - x0 + 1;
    let h = y1 - y0 + 1;
    if (w <= 0 || h <= 0 || w > 220 || h > 220) return;

    // rasterize the already planned blocks once, so tile checks stay O(1)
    let occupied = [];
    let oi = 0;
    for (oi = 0; oi < w * h; oi++) occupied[oi] = 0;
    for (let pi = 0; pi < allPlans.length; pi++) {
        let p = allPlans[pi];
        let psize = p.block.size | 0;
        let poff = Math.floor((psize - 1) / 2);
        for (let ax = 0; ax < psize; ax++) {
            for (let ay = 0; ay < psize; ay++) {
                let px = (p.x | 0) + ax - poff;
                let py = (p.y | 0) + ay - poff;
                if (px < x0 || py < y0 || px > x1 || py > y1) continue;
                occupied[(py - y0) * w + (px - x0)] = 1;
            }
        }
    }

    // free grid + distance field from the exit
    let free = [];
    let dist = [];
    for (let gy = 0; gy < h; gy++) {
        for (let gx = 0; gx < w; gx++) {
            let idx = gy * w + gx;
            free[idx] = (occupied[idx] === 0 && Util.canPlaceBlock(belt, team, x0 + gx, y0 + gy, 0)) ? 1 : 0;
            dist[idx] = -1;
        }
    }

    // provisional belt seed per drill: any free perimeter tile (used to choose the exit)
    let terminals = [];
    for (let s = 0; s < selection.length; s++) {
        let b2 = selection[s].bounds;
        let best = null;
        for (let ax = b2.minX - 1; ax <= b2.maxX && best === null; ax++) {
            for (let ay = b2.minY - 1; ay <= b2.maxY && best === null; ay++) {
                let onPerimeter = (ax === b2.minX - 1 || ax === b2.maxX || ay === b2.minY - 1 || ay === b2.maxY);
                if (!onPerimeter) continue;
                if (ax < x0 || ay < y0 || ax > x1 || ay > y1) continue;
                if (free[(ay - y0) * w + (ax - x0)] === 1) best = { x: ax, y: ay };
            }
        }
        if (best !== null) terminals.push({ x: best.x, y: best.y, bounds: b2 });
    }
    if (terminals.length === 0) return;

    // exit = the seed that can reach the most other seeds (never a sealed pocket)
    let cx = (minX + maxX) / 2;
    let cy = (minY + maxY) / 2;
    let root = terminals[0];
    let bestReach = -1;
    let bestCheb = -1;
    for (let cand = 0; cand < terminals.length; cand++) {
        routeFlood(free, dist, w, h, terminals[cand].x - x0, terminals[cand].y - y0);
        let reach = 0;
        for (let t5 = 0; t5 < terminals.length; t5++) {
            if (dist[(terminals[t5].y - y0) * w + (terminals[t5].x - x0)] >= 0) reach++;
        }
        let cheb = Math.max(Math.abs(terminals[cand].x - cx), Math.abs(terminals[cand].y - cy));
        if (reach > bestReach || (reach === bestReach && cheb > bestCheb)) {
            bestReach = reach;
            bestCheb = cheb;
            root = terminals[cand];
        }
    }
    routeFlood(free, dist, w, h, root.x - x0, root.y - y0);

    // walk every seed up the gradient toward the exit, merging into existing belts
    let placed = [];
    let placedCount = 0;
    for (let t2 = 0; t2 < terminals.length; t2++) {
        // among the drill's free perimeter tiles, start from the one nearest the exit
        let b4 = terminals[t2].bounds;
        let bestDist = (terminals[t2].y - y0) * w + (terminals[t2].x - x0) >= 0 ? dist[(terminals[t2].y - y0) * w + (terminals[t2].x - x0)] : -1;
        let bestX = terminals[t2].x;
        let bestY = terminals[t2].y;
        for (let ax2 = b4.minX - 1; ax2 <= b4.maxX; ax2++) {
            for (let ay2 = b4.minY - 1; ay2 <= b4.maxY; ay2++) {
                let onPerimeter2 = (ax2 === b4.minX - 1 || ax2 === b4.maxX || ay2 === b4.minY - 1 || ay2 === b4.maxY);
                if (!onPerimeter2) continue;
                if (ax2 < x0 || ay2 < y0 || ax2 > x1 || ay2 > y1) continue;
                let idx2 = (ay2 - y0) * w + (ax2 - x0);
                if (free[idx2] === 1 && dist[idx2] >= 0 && (bestDist < 0 || dist[idx2] < bestDist)) {
                    bestDist = dist[idx2];
                    bestX = ax2;
                    bestY = ay2;
                }
            }
        }
        terminals[t2].x = bestX;
        terminals[t2].y = bestY;

        let cxi = terminals[t2].x;
        let cyi = terminals[t2].y;
        let guard = 0;
        while (guard++ < w * h) {
            let idx = (cyi - y0) * w + (cxi - x0);
            if (dist[idx] <= 0) break;
            if (placed[idx] === 1) break;
            let nx = cxi;
            let ny = cyi;
            let rot = -1;
            if (cxi + 1 <= x1 && dist[(cyi - y0) * w + (cxi + 1 - x0)] === dist[idx] - 1) {
                nx = cxi + 1; ny = cyi; rot = 0;
            } else if (cyi + 1 <= y1 && dist[(cyi + 1 - y0) * w + (cxi - x0)] === dist[idx] - 1) {
                nx = cxi; ny = cyi + 1; rot = 1;
            } else if (cxi - 1 >= x0 && dist[(cyi - y0) * w + (cxi - 1 - x0)] === dist[idx] - 1) {
                nx = cxi - 1; ny = cyi; rot = 2;
            } else if (cyi - 1 >= y0 && dist[(cyi - 1 - y0) * w + (cxi - x0)] === dist[idx] - 1) {
                nx = cxi; ny = cyi - 1; rot = 3;
            }
            if (rot === -1) break;

            allPlans.push(new BuildPlan(cxi | 0, cyi | 0, rot | 0, belt));
            placed[idx] = 1;
            placedCount++;
            cxi = nx;
            cyi = ny;
        }
    }
    if (placedCount === 0) return;

    // exit belt: keep the flow going outward from the tree
    let rootIdx = (root.y - y0) * w + (root.x - x0);
    if (placed[rootIdx] !== 1) {
        let erot = -1;
        if (root.x - 1 >= x0 && dist[(root.y - y0) * w + (root.x - 1 - x0)] === 1) erot = 0;
        else if (root.y - 1 >= y0 && dist[(root.y - 1 - y0) * w + (root.x - x0)] === 1) erot = 1;
        else if (root.x + 1 <= x1 && dist[(root.y - y0) * w + (root.x + 1 - x0)] === 1) erot = 2;
        else if (root.y + 1 <= y1 && dist[(root.y + 1 - y0) * w + (root.x - x0)] === 1) erot = 3;
        if (erot === -1 && root.bounds !== undefined) {
            // dead-end pocket: still give the drill a belt, aimed away from it
            let cxb = (root.bounds.minX + root.bounds.maxX - 1) / 2;
            let cyb = (root.bounds.minY + root.bounds.maxY - 1) / 2;
            let dxb = root.x - cxb;
            let dyb = root.y - cyb;
            if (Math.abs(dxb) >= Math.abs(dyb)) {
                erot = dxb >= 0 ? 0 : 2;
            } else {
                erot = dyb >= 0 ? 1 : 3;
            }
        }
        if (erot !== -1) {
            allPlans.push(new BuildPlan(root.x | 0, root.y | 0, erot | 0, belt));
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

    let routingKey = Core.bundle.get("auto-drill.settings.place-conveyor-routing");
    if (Core.settings.getBool(routingKey, true)) {
        placeConveyorRouting(selection, team, allPlans);
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
