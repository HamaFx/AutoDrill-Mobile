"use strict";

const Direction = require("direction");
const Util = require("util");

function getDirectionOffsetForDrill(direction, block) {
    let size = block.size | 0;
    let offset2 = Math.floor(size / 2);

    if (direction === Direction.RIGHT) return { x: -offset2, y: 0 };
    if (direction === Direction.UP)    return { x: 0, y: -offset2 };
    if (direction === Direction.LEFT)  return { x: -offset2, y: -1 };
    return { x: -offset2, y: 0 }; // DOWN
}

function getDirectionOffsetForDuct(direction, block) {
    let size = block.size | 0;
    let offset1 = Math.floor((size - 1) / 2);
    let offset2 = Math.floor(size / 2);

    if (direction === Direction.RIGHT) return { x: -offset2, y: 0 };
    if (direction === Direction.UP)    return { x: 0, y: -offset2 };
    if (direction === Direction.LEFT)  return { x: offset1, y: 0 };
    return { x: offset1, y: 0 }; // DOWN
}

function getConnectedWallTiles(tile, direction) {
    let queue = [tile];
    let head = 0;
    const tiles = [];
    let visited = new Set();
    let sourceItem = tile.wallDrop();

    let baseSetting = Core.settings.getInt("mechanical-drill-max-tiles", 200);
    let maxTiles = Math.floor(baseSetting * 0.25);

    while (head < queue.length && tiles.length < maxTiles) {
        let currentTile = queue[head++];
        let pos = currentTile.pos();
        if (visited.has(pos)) continue;

        if (currentTile.wallDrop() === sourceItem) {
            for (let dx = -2; dx <= 2; dx++) {
                for (let dy = -2; dy <= 2; dy++) {
                    if (dx === 0 && dy === 0) continue;
                    let neighbor = currentTile.nearby(dx, dy);
                    if (neighbor == null) continue;

                    let nearby = neighbor.nearby((-direction.x) | 0, (-direction.y) | 0);
                    if (!visited.has(neighbor.pos()) && nearby != null && !nearby.solid()) {
                        queue.push(neighbor);
                    }
                }
            }
            tiles.push(currentTile);
        }
        visited.add(pos);
    }

    let filtered = tiles.filter(function(t1) {
        let paT1 = direction.primaryAxis(t1.x, t1.y);
        let saT1 = direction.secondaryAxis(t1.x, t1.y);
        for (let i = 0; i < tiles.length; i++) {
            let t2 = tiles[i];
            if (t2 !== t1
                && direction.secondaryAxis(t2.x, t2.y) === saT1
                && direction.primaryAxis(t2.x, t2.y) < paT1) {
                return false;
            }
        }
        return true;
    });

    filtered.sort(function(a, b) {
        return direction.secondaryAxis(a.x, a.y) - direction.secondaryAxis(b.x, b.y);
    });

    return filtered;
}

function containsTile(arr, tile) {
    let pos = tile.pos();
    for (let i = 0; i < arr.length; i++) {
        if (arr[i].pos() === pos) return true;
    }
    return false;
}

function fill(tile, drill, direction) {
    let team = Vars.player.team();
    let tiles = getConnectedWallTiles(tile, direction);

    const boreTiles = [];
    let occupiedSecondaryAxis = new Set();

    let directionOpposite = Direction.getOpposite(direction);
    let offset = getDirectionOffsetForDrill(direction, drill);
    let offsetOpposite = getDirectionOffsetForDuct(directionOpposite, drill);

    let allPlans = [];
    let drillSize = drill.size | 0;
    let halfLow = Math.floor((drillSize - 1) / 2);
    let halfHigh = Math.floor(drillSize / 2);
    let range = drill.range | 0;

    // Phase 1: find valid bore placements
    for (let idx = 0; idx < tiles.length; idx++) {
        let tile1 = tiles[idx];
        for (let i = 0; i < range; i++) {
            let boreTile = tile1.nearby(
                ((i + 1) * -direction.x + offset.x) | 0,
                ((i + 1) * -direction.y + offset.y) | 0
            );
            if (boreTile == null) continue;

            let borePlan = new BuildPlan(boreTile.x | 0, boreTile.y | 0, direction.r | 0, drill);
            if (Util.canPlaceWithoutPlanCollision(borePlan, team, allPlans)) {
                let sa = direction.secondaryAxis(boreTile.x, boreTile.y);
                let occupied = false;
                for (let j = -halfLow; j <= halfHigh; j++) {
                    if (occupiedSecondaryAxis.has(sa + j)) {
                        occupied = true;
                        break;
                    }
                }
                if (occupied) continue;

                for (let j = -halfLow; j <= halfHigh; j++) {
                    occupiedSecondaryAxis.add(sa + j);
                }

                boreTiles.push(boreTile);
                allPlans.push(borePlan);
                break;
            }
        }
    }
    if (boreTiles.length === 0) return;

    // Phase 2: compute duct tile positions
    let ductTiles = [];
    for (let idx = 0; idx < boreTiles.length; idx++) {
        let boreTile = boreTiles[idx];
        for (let i = -halfLow; i <= halfHigh; i++) {
            let dx = (-offsetOpposite.x + directionOpposite.x + (i * Math.abs(direction.y))) | 0;
            let dy = (-offsetOpposite.y + directionOpposite.y + (i * Math.abs(direction.x))) | 0;
            let ductTile = boreTile.nearby(dx, dy);
            if (ductTile != null) {
                ductTiles.push(ductTile);
            }
        }
    }
    if (ductTiles.length === 0) return;

    // Phase 3: build connecting duct network
    let candidateOutermost = ductTiles.filter(function(t) {
        let tSa = direction.secondaryAxis(t.x, t.y);
        for (let i = 0; i < boreTiles.length; i++) {
            let bt = boreTiles[i];
            if (direction.secondaryAxis(bt.x, bt.y) === tSa) return false;
        }
        return true;
    });
    if (candidateOutermost.length === 0) return;

    let outerMostDuctTile = candidateOutermost[0];
    let bestScore = -direction.primaryAxis(outerMostDuctTile.x, outerMostDuctTile.y);
    for (let i = 1; i < candidateOutermost.length; i++) {
        let cand = candidateOutermost[i];
        let score = -direction.primaryAxis(cand.x, cand.y);
        if (score > bestScore) {
            bestScore = score;
            outerMostDuctTile = cand;
        }
    }

    const outerDuct = outerMostDuctTile;
    ductTiles.sort(function(a, b) {
        return a.dst2(outerDuct) - b.dst2(outerDuct);
    });

    const connectingTiles = [outerMostDuctTile];
    for (let idx = 0; idx < ductTiles.length; idx++) {
        let ductTile = ductTiles[idx];
        if (containsTile(connectingTiles, ductTile)) continue;

        let closestDuctTile = connectingTiles[0];
        let minDst2 = closestDuctTile.dst2(ductTile);
        for (let j = 1; j < connectingTiles.length; j++) {
            let d2 = connectingTiles[j].dst2(ductTile);
            if (d2 < minDst2) {
                minDst2 = d2;
                closestDuctTile = connectingTiles[j];
            }
        }

        let cx = ductTile.x | 0;
        let cy = ductTile.y | 0;
        let gx = closestDuctTile.x | 0;
        let gy = closestDuctTile.y | 0;
        let paGoal = direction.primaryAxis(gx, gy);
        let saGoal = direction.secondaryAxis(gx, gy);

        let guard = 0;
        while ((cx !== gx || cy !== gy) && guard++ < 2000) {
            let pa = direction.primaryAxis(cx, cy);
            let sa = direction.secondaryAxis(cx, cy);

            let currentTile = Vars.world.tile(cx, cy);
            if (currentTile != null && !containsTile(connectingTiles, currentTile)) {
                connectingTiles.push(currentTile);
            }

            if ((pa < paGoal && sa === saGoal) || pa > paGoal) {
                if (Math.abs(pa) < Math.abs(paGoal)) {
                    cx += Math.abs(direction.x);
                    cy += Math.abs(direction.y);
                } else {
                    cx -= Math.abs(direction.x);
                    cy -= Math.abs(direction.y);
                }
            } else {
                if (Math.abs(sa) < Math.abs(saGoal)) {
                    cx += Math.abs(direction.y);
                    cy += Math.abs(direction.x);
                } else {
                    cx -= Math.abs(direction.y);
                    cy -= Math.abs(direction.x);
                }
            }
        }
    }

    // Phase 4: generate duct plans with validation
    connectingTiles.sort(function(a, b) {
        return outerDuct.dst(a) - outerDuct.dst(b);
    });

    const visitedTiles = [outerMostDuctTile];
    const connectingWork = connectingTiles.slice();

    while (connectingWork.length > 0) {
        let tile1 = null;
        let tile2 = null;

        for (let i = 0; i < connectingWork.length; i++) {
            let connectingTile = connectingWork[i];
            let adjacent = null;
            for (let j = 0; j < visitedTiles.length; j++) {
                if (connectingTile.relativeTo(visitedTiles[j]) !== -1) {
                    adjacent = visitedTiles[j];
                    break;
                }
            }
            if (adjacent != null) {
                tile1 = adjacent;
                tile2 = connectingTile;
                visitedTiles.push(connectingTile);
                connectingWork.splice(i, 1);
                break;
            }
        }
        if (tile1 == null || tile2 == null) break;

        if (tile2.pos() === outerMostDuctTile.pos()) {
            let ductPlan1 = new BuildPlan(tile2.x | 0, tile2.y | 0, directionOpposite.r | 0, Blocks.duct);
            if (Util.canPlaceWithoutPlanCollision(ductPlan1, team, allPlans)) {
                allPlans.push(ductPlan1);
            }
            let ductPlan2 = new BuildPlan(
                (tile2.x + directionOpposite.x) | 0,
                (tile2.y + directionOpposite.y) | 0,
                directionOpposite.r | 0,
                Blocks.duct
            );
            if (Util.canPlaceWithoutPlanCollision(ductPlan2, team, allPlans)) {
                allPlans.push(ductPlan2);
            }
        } else {
            let ductPlan = new BuildPlan(tile2.x | 0, tile2.y | 0, tile2.relativeTo(tile1) | 0, Blocks.duct);
            if (Util.canPlaceWithoutPlanCollision(ductPlan, team, allPlans)) {
                allPlans.push(ductPlan);
            }
        }
    }

    for (let i = 0; i < connectingTiles.length; i++) {
        let ductTile = connectingTiles[i];
        let neighbor = null;
        for (let j = 0; j < i; j++) {
            if (connectingTiles[j].relativeTo(ductTile) !== -1) {
                neighbor = connectingTiles[j];
                break;
            }
        }
        if (neighbor == null) continue;

        let ductPlan = new BuildPlan(ductTile.x | 0, ductTile.y | 0, ductTile.relativeTo(neighbor) | 0, Blocks.duct);
        if (Util.canPlaceWithoutPlanCollision(ductPlan, team, allPlans)) {
            allPlans.push(ductPlan);
        }
    }

    // Phase 5: beam nodes
    let outerMost = boreTiles[0];
    let bestBoreScore = -direction.primaryAxis(outerMost.x, outerMost.y);
    for (let i = 1; i < boreTiles.length; i++) {
        let score = -direction.primaryAxis(boreTiles[i].x, boreTiles[i].y);
        if (score > bestBoreScore) {
            bestBoreScore = score;
            outerMost = boreTiles[i];
        }
    }

    for (let i = 0; i < boreTiles.length; i++) {
        let boreTile = boreTiles[i];
        let bx = (Math.abs(direction.x) * outerMost.x + Math.abs(direction.y) * boreTile.x - offsetOpposite.x + directionOpposite.x * 2) | 0;
        let by = (Math.abs(direction.y) * outerMost.y + Math.abs(direction.x) * boreTile.y - offsetOpposite.y + directionOpposite.y * 2) | 0;
        let beamNodeTile = Vars.world.tile(bx, by);
        if (beamNodeTile == null) continue;

        let beamPlan = new BuildPlan(beamNodeTile.x | 0, beamNodeTile.y | 0, 0, Blocks.beamNode);
        if (Util.canPlaceWithoutPlanCollision(beamPlan, team, allPlans)) {
            allPlans.push(beamPlan);
        }

        while (beamNodeTile.dst(boreTile) > 10 * Vars.tilesize) {
            beamNodeTile = beamNodeTile.nearby((direction.x * 5) | 0, (direction.y * 5) | 0);
            if (beamNodeTile == null) break;

            let chainPlan = new BuildPlan(beamNodeTile.x | 0, beamNodeTile.y | 0, 0, Blocks.beamNode);
            if (Util.canPlaceWithoutPlanCollision(chainPlan, team, allPlans)) {
                allPlans.push(chainPlan);
            }
        }
    }

    Util.commitPlans(allPlans);
}

module.exports = {
    fill: fill
};
