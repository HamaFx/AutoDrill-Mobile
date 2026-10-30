"use strict";

function makeDirection(name, x, y, r) {
    return {
        name: name,
        x: x,
        y: y,
        p: new Point2(x, y),
        r: r,
        primaryAxis: function(pxOrPoint, py) {
            if (py === undefined) {
                return pxOrPoint.x * x + pxOrPoint.y * y;
            }
            return pxOrPoint * x + py * y;
        },
        secondaryAxis: function(pxOrPoint, py) {
            if (py === undefined) {
                return pxOrPoint.x * y + pxOrPoint.y * x;
            }
            return pxOrPoint * y + py * x;
        }
    };
}

const Direction = {
    RIGHT: makeDirection("RIGHT", 1, 0, 0),
    UP: makeDirection("UP", 0, 1, 1),
    LEFT: makeDirection("LEFT", -1, 0, 2),
    DOWN: makeDirection("DOWN", 0, -1, 3),

    getOpposite: function(direction) {
        if (direction === Direction.RIGHT) return Direction.LEFT;
        if (direction === Direction.UP) return Direction.DOWN;
        if (direction === Direction.LEFT) return Direction.RIGHT;
        return Direction.UP;
    }
};

module.exports = Direction;
