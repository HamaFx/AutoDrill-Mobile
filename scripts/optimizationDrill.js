"use strict";

const Util = require("util");

// Conveyor routing tuning (laser / airblast fills only).
const ROUTING_TARGET_RADIUS = 24;
const ROUTING_MAX_GRID = 220;
const ROUTING_BRIDGE_RANGE = 4;
const ROUTING_DIR_X = [1, 0, -1, 0];
const ROUTING_DIR_Y = [0, 1, 0, -1];

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

function sameTeam(a, b) {
    if (a === b) return true;
    if (a === null || a === undefined || b === null || b === undefined) return false;
    return String(a) === String(b);
}

function isRoutingDrillBlock(block) {
    return block === Blocks.mechanicalDrill
        || block === Blocks.pneumaticDrill
        || block === Blocks.laserDrill
        || block === Blocks.blastDrill
        || block === Blocks.impactDrill
        || block === Blocks.eruptionDrill
        || block === Blocks.plasmaBore;
}

/**
 * Finds the closest friendly building the fill can instead feed: any item-accepting
 * block (conveyor, duct, container, core, turret...) within ROUTING_TARGET_RADIUS of
 * the drill bounding box. Drills are never used as targets.
 */
function findTransportTarget(team, minX, minY, maxX, maxY) {
    let sx = minX - ROUTING_TARGET_RADIUS;
    if (sx < 0) sx = 0;
    let sy = minY - ROUTING_TARGET_RADIUS;
    if (sy < 0) sy = 0;
    let ex = maxX + ROUTING_TARGET_RADIUS;
    if (ex > Vars.world.width() - 1) ex = Vars.world.width() - 1;
    let ey = maxY + ROUTING_TARGET_RADIUS;
    if (ey > Vars.world.height() - 1) ey = Vars.world.height() - 1;

    let best = null;
    let bestDist = 0;
    for (let x = sx; x <= ex; x++) {
        for (let y = sy; y <= ey; y++) {
            let t = Vars.world.tile(x, y);
            if (t === null) continue;
            let b = t.build;
            if (b === null || b === undefined) continue;
            let blk = t.block();
            // note: `blk.isAir` must NOT be read as a property - in Mindustry v8 it is a
            // method, so Rhino hands back a truthy function object. Identity is reliable.
            if (blk === null || blk === Blocks.air) continue;
            if (!blk.hasItems) continue;
            if (isRoutingDrillBlock(blk)) continue;
            if (!sameTeam(b.team, team)) continue;

            let dx = x < minX ? minX - x : (x > maxX ? x - maxX : 0);
            let dy = y < minY ? minY - y : (y > maxY ? y - maxY : 0);
            let d = dx > dy ? dx : dy;
            if (best === null || d < bestDist) {
                best = { x: x, y: y };
                bestDist = d;
            }
        }
    }
    return best;
}

/** Belt rotation that points away from the center of the given block bounds. */
function awayRotation(bounds, x, y) {
    let cxb = (bounds.minX + bounds.maxX - 1) / 2;
    let cyb = (bounds.minY + bounds.maxY - 1) / 2;
    let dxb = x - cxb;
    let dyb = y - cyb;
    if (Math.abs(dxb) >= Math.abs(dyb)) {
        return dxb >= 0 ? 0 : 2;
    }
    return dyb >= 0 ? 1 : 3;
}

/** Direction preference for a walk step: straight first, then a turn, backwards last. */
function stepOrder(lastRot) {
    if (lastRot < 0) return [0, 1, 2, 3];
    return [lastRot, (lastRot + 1) % 4, (lastRot + 3) % 4, (lastRot + 2) % 4];
}

/**
 * Rotation for a belt that is not part of a gradient chain (stubs, exit belts).
 * It may only aim at a tile without a placed belt: a belt pointing into a belt that
 * flows back would make items loop forever. Prefers open, belt-placeable ground.
 */
function pickEmptyRotation(placed, free, w, h, x0, y0, x1, y1, x, y, preferred) {
    let order = stepOrder(preferred);
    let i = 0;
    for (i = 0; i < 4; i++) {
        let r = order[i];
        let tx = x + ROUTING_DIR_X[r];
        let ty = y + ROUTING_DIR_Y[r];
        if (tx < x0 || ty < y0 || tx > x1 || ty > y1) continue;
        let idx = (ty - y0) * w + (tx - x0);
        if (placed[idx] === 1) continue;
        if (free[idx] !== 1) continue;
        return r;
    }
    for (i = 0; i < 4; i++) {
        let r2 = order[i];
        let tx2 = x + ROUTING_DIR_X[r2];
        let ty2 = y + ROUTING_DIR_Y[r2];
        if (tx2 < x0 || ty2 < y0 || tx2 > x1 || ty2 > y1) continue;
        let idx2 = (ty2 - y0) * w + (tx2 - x0);
        if (placed[idx2] === 1) continue;
        return r2;
    }
    return -1;
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

/** Axis direction index from one point toward another (dominant axis). */
function dirToward(fromX, fromY, toX, toY) {
    let dx = toX - fromX;
    let dy = toY - fromY;
    if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 0 : 2;
    return dy >= 0 ? 1 : 3;
}

/** Nearest friendly core (used to aim exits at the player's base), or null. */
function findNearestCore(team, cx, cy) {
    try {
        if (Vars.state == null || Vars.state.teams == null) return null;
        let cores = Vars.state.teams.cores(team);
        if (cores == null || cores.size === 0) return null;
        let best = null;
        let bestD = 0;
        for (let i = 0; i < cores.size; i++) {
            let c = cores.get(i);
            let cxx = c.tileX();
            let cyy = c.tileY();
            let d = Math.abs(cxx - cx) + Math.abs(cyy - cy);
            if (best === null || d < bestD) {
                best = { x: cxx, y: cyy };
                bestD = d;
            }
        }
        return best;
    } catch (e) {
        return null;
    }
}

/**
 * Mechanical-drill style bridge jump: when a drill cannot be reached by belts,
 * send its output over the blockage instead. Finds an axis-aligned chain of
 * item bridges (first bridge on the drill's free ring tile, each hop at most
 * ROUTING_BRIDGE_RANGE tiles - hops may cross over drills and obstacles) that
 * ends next to the existing belt network, where the outlet bridge dumps into it.
 */
function tryBridgeJump(bounds, stub, team, allPlans, beltPos, placed, w, h, x0, y0, x1, y1) {
    let maxHops = 4;
    let visited = {};
    visited[stub.x + "," + stub.y] = true;
    let queue = [{ x: stub.x, y: stub.y, dir: -1, hop: 0, path: [{ x: stub.x, y: stub.y }] }];
    let head = 0;

    while (head < queue.length) {
        let cur = queue[head++];
        if (cur.hop >= maxHops) continue;

        let order = stepOrder(cur.dir < 0 ? -1 : cur.dir);
        for (let oi = 0; oi < 4; oi++) {
            let dj = order[oi];
            if (cur.dir >= 0 && dj === (cur.dir + 2) % 4) continue; // no u-turns

            let dxj = ROUTING_DIR_X[dj];
            let dyj = ROUTING_DIR_Y[dj];

            if (cur.hop === 0) {
                // the first hop must not aim back through the drill itself
                let fx = stub.x + dxj;
                let fy = stub.y + dyj;
                if (fx >= bounds.minX && fx < bounds.maxX && fy >= bounds.minY && fy < bounds.maxY) continue;
            }

            for (let jd = 2; jd <= ROUTING_BRIDGE_RANGE; jd++) {
                let px = cur.x + dxj * jd;
                let py = cur.y + dyj * jd;
                if (visited[px + "," + py]) continue;
                if (!Util.canPlaceBlock(Blocks.itemBridge, team, px, py, 0)) continue;
                if (Util.footprintOverlapsPlanned(Blocks.itemBridge, px, py, allPlans)) continue;
                visited[px + "," + py] = true;

                let touchesNet = false;
                for (let sj = 0; sj < 4 && !touchesNet; sj++) {
                    let nx = px + ROUTING_DIR_X[sj];
                    let ny = py + ROUTING_DIR_Y[sj];
                    if (beltPos[nx + "," + ny] === 1) {
                        touchesNet = true;
                    } else {
                        // the player's existing item bridges work too (mechanical parity)
                        let wt = Vars.world.tile(nx, ny);
                        if (wt !== null && wt.build != null && wt.block() === Blocks.itemBridge && sameTeam(wt.build.team, team)) {
                            touchesNet = true;
                        }
                    }
                }

                if (touchesNet) {
                    // build the chain: every bridge links to the next, the last is an outlet
                    let path = cur.path.slice();
                    path.push({ x: px, y: py });
                    let plans = [];
                    let ok = true;
                    for (let pi = 0; pi < path.length && ok; pi++) {
                        let isLast = pi === path.length - 1;
                        let cfgX = 0;
                        let cfgY = 0;
                        if (!isLast) {
                            cfgX = path[pi + 1].x - path[pi].x;
                            cfgY = path[pi + 1].y - path[pi].y;
                        }
                        let plan = new BuildPlan(path[pi].x | 0, path[pi].y | 0, 0, Blocks.itemBridge, new Point2(cfgX | 0, cfgY | 0));
                        if (!Util.canPlaceWithoutPlanCollision(plan, team, allPlans)) {
                            ok = false;
                        } else {
                            plans.push(plan);
                        }
                    }
                    if (ok) {
                        for (let pi2 = 0; pi2 < plans.length; pi2++) {
                            allPlans.push(plans[pi2]);
                            let tx = plans[pi2].x | 0;
                            let ty = plans[pi2].y | 0;
                            if (tx >= x0 && tx <= x1 && ty >= y0 && ty <= y1) {
                                placed[(ty - y0) * w + (tx - x0)] = 1;
                            }
                        }
                        return true;
                    }
                }

                let npath = cur.path.slice();
                npath.push({ x: px, y: py });
                queue.push({ x: px, y: py, dir: dj, hop: cur.hop + 1, path: npath });
            }
        }
    }
    return false;
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

    // nearby friendly transport the tree should feed into (null when nothing is close)
    let target = findTransportTarget(team, minX, minY, maxX, maxY);

    let margin = 2;
    let x0 = minX - margin;
    let y0 = minY - margin;
    let x1 = maxX + margin;
    let y1 = maxY + margin;
    let w = x1 - x0 + 1;
    let h = y1 - y0 + 1;
    if (w <= 0 || h <= 0 || w > ROUTING_MAX_GRID || h > ROUTING_MAX_GRID) return;

    if (target !== null) {
        // grow the working region just enough to include the transport
        if (target.x - 1 < x0) x0 = target.x - 1;
        if (target.y - 1 < y0) y0 = target.y - 1;
        if (target.x + 1 > x1) x1 = target.x + 1;
        if (target.y + 1 > y1) y1 = target.y + 1;
        let w2 = x1 - x0 + 1;
        let h2 = y1 - y0 + 1;
        if (w2 > ROUTING_MAX_GRID || h2 > ROUTING_MAX_GRID) {
            // too large to route through: keep the original region, drop the target
            target = null;
            x0 = minX - margin;
            y0 = minY - margin;
            x1 = maxX + margin;
            y1 = maxY + margin;
        }
    }
    w = x1 - x0 + 1;
    h = y1 - y0 + 1;

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

    // distance field from the transport target (its own tile is blocked, so floods start at dist 1)
    let distT = null;
    if (target !== null) {
        distT = [];
        routeFlood(free, distT, w, h, target.x - x0, target.y - y0);
    }

    // provisional belt seed per drill: a free perimeter tile (used to choose the exit)
    let terminals = [];
    for (let s = 0; s < selection.length; s++) {
        let b2 = selection[s].bounds;
        let best = null;
        let bestD = -1;
        for (let ax = b2.minX - 1; ax <= b2.maxX; ax++) {
            for (let ay = b2.minY - 1; ay <= b2.maxY; ay++) {
                let onPerimeter = (ax === b2.minX - 1 || ax === b2.maxX || ay === b2.minY - 1 || ay === b2.maxY);
                if (!onPerimeter) continue;
                if (ax < x0 || ay < y0 || ax > x1 || ay > y1) continue;
                let idx = (ay - y0) * w + (ax - x0);
                if (free[idx] !== 1) continue;
                let d = distT !== null ? distT[idx] : -1;
                if (best === null) {
                    best = { x: ax, y: ay };
                    bestD = d;
                } else if (target !== null && d >= 0 && (bestD < 0 || d < bestD)) {
                    best = { x: ax, y: ay };
                    bestD = d;
                }
            }
        }
        if (best !== null) terminals.push({ x: best.x, y: best.y, bounds: b2 });
    }
    if (terminals.length === 0) return;

    // exit = the seed that can reach the most other seeds (never a sealed pocket);
    // among equals: prefer a seed that can reach the transport, then the closest one
    let cx = (minX + maxX) / 2;
    let cy = (minY + maxY) / 2;
    let core = findNearestCore(team, cx, cy);
    let root = terminals[0];
    let bestReach = -1;
    let bestCompSize = -1;
    let bestReachesT = false;
    let bestDistT = -1;
    let bestCheb = -1;
    for (let cand = 0; cand < terminals.length; cand++) {
        routeFlood(free, dist, w, h, terminals[cand].x - x0, terminals[cand].y - y0);
        let reach = 0;
        for (let t5 = 0; t5 < terminals.length; t5++) {
            if (dist[(terminals[t5].y - y0) * w + (terminals[t5].x - x0)] >= 0) reach++;
        }
        let compSize = 0;
        for (let c5 = 0; c5 < w * h; c5++) {
            if (dist[c5] >= 0) compSize++;
        }
        let reachesT = false;
        let candDistT = -1;
        if (distT !== null) {
            candDistT = distT[(terminals[cand].y - y0) * w + (terminals[cand].x - x0)];
            reachesT = candDistT >= 0;
        }
        let cheb = Math.max(Math.abs(terminals[cand].x - cx), Math.abs(terminals[cand].y - cy));

        let better = false;
        if (reach !== bestReach) {
            better = reach > bestReach;
        } else if (reachesT !== bestReachesT) {
            better = reachesT;
        } else if (reachesT && bestReachesT && candDistT !== bestDistT) {
            better = candDistT < bestDistT;
        } else if (compSize !== bestCompSize) {
            // a bigger free-space component makes a healthier tree
            better = compSize > bestCompSize;
        } else if (core !== null) {
            // prefer the seed on the core side, so the exit points toward the base
            better = ((terminals[cand].x - cx) * (core.x - cx) + (terminals[cand].y - cy) * (core.y - cy))
                > ((root.x - cx) * (core.x - cx) + (root.y - cy) * (core.y - cy));
        } else {
            better = cheb > bestCheb;
        }

        if (better) {
            bestReach = reach;
            bestCompSize = compSize;
            bestReachesT = reachesT;
            bestDistT = candDistT;
            bestCheb = cheb;
            root = terminals[cand];
        }
    }
    routeFlood(free, dist, w, h, root.x - x0, root.y - y0);

    // snapshot the sink tile: terminal entries are mutated while walking, but every
    // later stage (line, coverage, exit) must use the original root position
    let rootX0 = root.x;
    let rootY0 = root.y;

    let placed = [];
    let treeBeltCount = 0;

    // transport line first: lay the path from the root to the nearby transport
    // BEFORE the tree grows, so the corridor can never be walled off by the tree
    // itself; tree chains then merge into this line wherever they meet it
    let linePlaced = 0;
    let rootIdx = (rootY0 - y0) * w + (rootX0 - x0);
    if (target !== null && distT !== null && distT[rootIdx] >= 0) {
        let cxi = rootX0;
        let cyi = rootY0;
        let lastRot = -1;
        let guard2 = 0;
        while (guard2++ < w * h) {
            let idx = (cyi - y0) * w + (cxi - x0);
            let dT = distT[idx];
            if (dT < 0) break;

            let rot = -1;
            if (dT === 1) {
                // next tile is the transport itself
                let ddx = target.x - cxi;
                let ddy = target.y - cyi;
                if (ddx === 1) rot = 0;
                else if (ddx === -1) rot = 2;
                else if (ddy === 1) rot = 1;
                else if (ddy === -1) rot = 3;
            } else {
                let order2 = stepOrder(lastRot);
                for (let oi3 = 0; oi3 < 4; oi3++) {
                    let r2 = order2[oi3];
                    let ax4 = cxi + ROUTING_DIR_X[r2];
                    let ay4 = cyi + ROUTING_DIR_Y[r2];
                    if (ax4 < x0 || ay4 < y0 || ax4 > x1 || ay4 > y1) continue;
                    if (distT[(ay4 - y0) * w + (ax4 - x0)] === dT - 1) {
                        rot = r2;
                        break;
                    }
                }
            }
            if (rot === -1) break;

            allPlans.push(new BuildPlan(cxi | 0, cyi | 0, rot | 0, belt));
            placed[idx] = 1;
            linePlaced++;
            treeBeltCount++;
            if (dT === 1) break;
            cxi += ROUTING_DIR_X[rot];
            cyi += ROUTING_DIR_Y[rot];
            lastRot = rot;
        }
    }

    // walk every seed up the gradient toward the exit, merging into existing belts;
    // prefer going straight so routes look clean instead of staircase-y
    for (let t2 = 0; t2 < terminals.length; t2++) {
        // among the drill's free perimeter tiles, start from the one nearest the exit;
        // the sink tile itself (dist 0) is never used as a walk start
        let b4 = terminals[t2].bounds;
        let bestDist = -1;
        let idxSeed = (terminals[t2].y - y0) * w + (terminals[t2].x - x0);
        if (idxSeed >= 0 && dist[idxSeed] >= 1) bestDist = dist[idxSeed];
        let bestX = terminals[t2].x;
        let bestY = terminals[t2].y;
        for (let ax2 = b4.minX - 1; ax2 <= b4.maxX; ax2++) {
            for (let ay2 = b4.minY - 1; ay2 <= b4.maxY; ay2++) {
                let onPerimeter2 = (ax2 === b4.minX - 1 || ax2 === b4.maxX || ay2 === b4.minY - 1 || ay2 === b4.maxY);
                if (!onPerimeter2) continue;
                if (ax2 < x0 || ay2 < y0 || ax2 > x1 || ay2 > y1) continue;
                let idx2 = (ay2 - y0) * w + (ax2 - x0);
                if (free[idx2] === 1 && dist[idx2] >= 1 && (bestDist < 0 || dist[idx2] < bestDist)) {
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
        let lastRot = -1;
        let guard = 0;
        while (guard++ < w * h) {
            let idx = (cyi - y0) * w + (cxi - x0);
            if (dist[idx] <= 0) break;
            if (placed[idx] === 1) break;

            let rot = -1;
            let order = stepOrder(lastRot);
            for (let oi2 = 0; oi2 < 4; oi2++) {
                let r = order[oi2];
                let ax3 = cxi + ROUTING_DIR_X[r];
                let ay3 = cyi + ROUTING_DIR_Y[r];
                if (ax3 < x0 || ay3 < y0 || ax3 > x1 || ay3 > y1) continue;
                if (dist[(ay3 - y0) * w + (ax3 - x0)] === dist[idx] - 1) {
                    rot = r;
                    break;
                }
            }
            if (rot === -1) break;

            allPlans.push(new BuildPlan(cxi | 0, cyi | 0, rot | 0, belt));
            placed[idx] = 1;
            treeBeltCount++;
            cxi += ROUTING_DIR_X[rot];
            cyi += ROUTING_DIR_Y[rot];
            lastRot = rot;
        }
    }

    // coverage pass: any drill still without an adjacent belt gets a connection, so
    // every drill can drain its ore (even in sealed pockets that the tree can't reach).
    // where possible a mechanical-style bridge jump is used: a bridge at the drill's
    // free ring tile links to an outlet bridge 2-4 tiles away that dumps into the
    // network, closing what would otherwise be a dead-end stub
    let beltPos = {};
    for (let bp = 0; bp < allPlans.length; bp++) {
        if (allPlans[bp].block === belt) {
            beltPos[(allPlans[bp].x | 0) + "," + (allPlans[bp].y | 0)] = 1;
        }
    }

    for (let s2 = 0; s2 < selection.length; s2++) {
        let b5 = selection[s2].bounds;
        let covered = false;
        for (let ax5 = b5.minX - 1; ax5 <= b5.maxX && !covered; ax5++) {
            for (let ay5 = b5.minY - 1; ay5 <= b5.maxY && !covered; ay5++) {
                let onP = (ax5 === b5.minX - 1 || ax5 === b5.maxX || ay5 === b5.minY - 1 || ay5 === b5.maxY);
                if (!onP) continue;
                if (ax5 < x0 || ay5 < y0 || ax5 > x1 || ay5 > y1) continue;
                let idx5 = (ay5 - y0) * w + (ax5 - x0);
                // the sink tile drains a drill only when a real tree feeds it;
                // otherwise the drill still needs its own jump or stub
                if (idx5 === rootIdx) {
                    if (treeBeltCount > 0) covered = true;
                } else if (placed[idx5] === 1) {
                    covered = true;
                }
            }
        }
        if (covered) continue;

        let stub = null;
        let stubD = -1;
        for (let ax6 = b5.minX - 1; ax6 <= b5.maxX; ax6++) {
            for (let ay6 = b5.minY - 1; ay6 <= b5.maxY; ay6++) {
                let onP2 = (ax6 === b5.minX - 1 || ax6 === b5.maxX || ay6 === b5.minY - 1 || ay6 === b5.maxY);
                if (!onP2) continue;
                if (ax6 < x0 || ay6 < y0 || ax6 > x1 || ay6 > y1) continue;
                let idx6 = (ay6 - y0) * w + (ax6 - x0);
                if (free[idx6] !== 1 || placed[idx6] === 1) continue;
                let d6 = distT !== null ? distT[idx6] : -1;
                if (stub === null) {
                    stub = { x: ax6, y: ay6 };
                    stubD = d6;
                } else if (d6 >= 0 && (stubD < 0 || d6 < stubD)) {
                    stub = { x: ax6, y: ay6 };
                    stubD = d6;
                }
            }
        }
        if (stub !== null) {
            // first try a mechanical-style bridge jump into the network (a few ring
            // tiles are tried as starts, since dense clusters need a lucky landing spot)
            if (tryBridgeJump(b5, stub, team, allPlans, beltPos, placed, w, h, x0, y0, x1, y1)) continue;
            let jumped2 = false;
            let tries2 = 0;
            for (let ax7 = b5.minX - 1; ax7 <= b5.maxX && !jumped2 && tries2 < 3; ax7++) {
                for (let ay7 = b5.minY - 1; ay7 <= b5.maxY && !jumped2 && tries2 < 3; ay7++) {
                    let onP7 = (ax7 === b5.minX - 1 || ax7 === b5.maxX || ay7 === b5.minY - 1 || ay7 === b5.maxY);
                    if (!onP7) continue;
                    if (ax7 === stub.x && ay7 === stub.y) continue;
                    if (ax7 < x0 || ay7 < y0 || ax7 > x1 || ay7 > y1) continue;
                    let idx7 = (ay7 - y0) * w + (ax7 - x0);
                    if (free[idx7] !== 1 || placed[idx7] === 1) continue;
                    tries2++;
                    if (tryBridgeJump(b5, { x: ax7, y: ay7 }, team, allPlans, beltPos, placed, w, h, x0, y0, x1, y1)) jumped2 = true;
                }
            }
            if (jumped2) continue;

            // no jump available: place a plain stub belt, only ever aimed at an empty
            // tile, so stub flows stay one-way (no belt loops)
            let stubPref = awayRotation(b5, stub.x, stub.y);
            if (core !== null) {
                let cd = dirToward(stub.x, stub.y, core.x, core.y);
                let cdx = stub.x + ROUTING_DIR_X[cd];
                let cdy = stub.y + ROUTING_DIR_Y[cd];
                let intoDrill = cdx >= b5.minX && cdx < b5.maxX && cdy >= b5.minY && cdy < b5.maxY;
                if (!intoDrill) stubPref = cd;
            }
            let rot6 = pickEmptyRotation(placed, free, w, h, x0, y0, x1, y1, stub.x, stub.y, stubPref);
            if (rot6 !== -1 && placed[(stub.y - y0) * w + (stub.x - x0)] !== 1) {
                allPlans.push(new BuildPlan(stub.x | 0, stub.y | 0, rot6 | 0, belt));
                placed[(stub.y - y0) * w + (stub.x - x0)] = 1;
            }
        }
    }

    // exit belt: keep the flow going outward from the tree (only when no transport line was built)
    if (linePlaced === 0 && placed[rootIdx] !== 1) {
        let preferred = -1;
        if (core !== null) {
            // aim the exit toward the player's core
            preferred = dirToward(rootX0, rootY0, core.x, core.y);
        }
        if (preferred === -1) {
            if (rootX0 - 1 >= x0 && dist[(rootY0 - y0) * w + (rootX0 - 1 - x0)] === 1) preferred = 0;
            else if (rootY0 - 1 >= y0 && dist[(rootY0 - 1 - y0) * w + (rootX0 - x0)] === 1) preferred = 1;
            else if (rootX0 + 1 <= x1 && dist[(rootY0 - y0) * w + (rootX0 + 1 - x0)] === 1) preferred = 2;
            else if (rootY0 + 1 <= y1 && dist[(rootY0 + 1 - y0) * w + (rootX0 - x0)] === 1) preferred = 3;
            if (preferred === -1 && root.bounds !== undefined) {
                // dead-end pocket: still give the drill a belt, aimed away from it
                preferred = awayRotation(root.bounds, rootX0, rootY0);
            }
        }
        // only ever aim at an empty tile: aiming into the tree itself would loop items forever
        let erot = pickEmptyRotation(placed, free, w, h, x0, y0, x1, y1, rootX0, rootY0, preferred);
        if (erot !== -1) {
            allPlans.push(new BuildPlan(rootX0 | 0, rootY0 | 0, erot | 0, belt));
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
    recursiveMaxSearch: recursiveMaxSearch,
    placeConveyorRouting: placeConveyorRouting
};
