/**
 * Check if projectile hits a rectangular castle using continuous collision detection
 * @param x0, y0 - Starting position
 * @param vx, vy - Initial velocity components
 * @param gravity - Gravity constant
 * @param wind - Horizontal wind acceleration
 * @param castleX - Castle center X position
 * @param castleWidth - Castle width
 * @param castleHeight - Castle height
 * @param groundY - Ground level Y coordinate
 * @returns collision time t if hit, null otherwise
 */
function checkCastleCollision(
  x0: number, y0: number,
  vx: number, vy: number,
  gravity: number, wind: number,
  castleX: number, castleWidth: number, castleHeight: number,
  groundY: number
): number | null {
  const CASTLE_HIT_ZONE_RATIO = 0.9;
  const horizontalMargin = (castleWidth * (1 - CASTLE_HIT_ZONE_RATIO)) / 2;
  const verticalMargin = (castleHeight * (1 - CASTLE_HIT_ZONE_RATIO)) / 2;

  // Require the projectile to enter the central 90% of the castle bounds.
  const left = castleX - castleWidth / 2 + horizontalMargin;
  const right = castleX + castleWidth / 2 - horizontalMargin;
  const top = groundY - castleHeight + verticalMargin;
  const bottom = groundY - verticalMargin;
  
  // Find all intersection times with each edge
  const intersections: number[] = [];
  
  // 1. LEFT EDGE (x = left)
  // Solve: x0 + vx*t = left
  // t = (left - x0) / vx
  if (vx !== 0) {
      const times = solveQuadratic(0.5 * wind, vx, x0 - left);
      for (const t of times) {
      if (t >= 0) {
      const y = y0 + vy * t + 0.5 * gravity * t * t;
      if (y >= top && y <= bottom) {
        intersections.push(t);
      }
    }
      }
  }
  
  // 2. RIGHT EDGE (x = right)
  // Solve: x0 + vx*t = right
  // t = (right - x0) / vx
  if (vx !== 0) {
    const times = solveQuadratic(0.5 * wind, vx, x0 - right);
    for (const t of times) {
    if (t >= 0) {
      const y = y0 + vy * t + 0.5 * gravity * t * t;
      if (y >= top && y <= bottom) {
        intersections.push(t);
      }
    }
    }
  }
  
  // 3. TOP EDGE (y = top)
  // Solve: y0 + vy*t + 0.5*g*t² = top
  // 0.5*g*t² + vy*t + (y0 - top) = 0
  // This is quadratic: a*t² + b*t + c = 0
  const a_top = 0.5 * gravity;
  const b_top = vy;
  const c_top = y0 - top;
  const times_top = solveQuadratic(a_top, b_top, c_top);
  for (const t of times_top) {
    if (t >= 0) {
      const x = x0 + vx * t + 0.5 * wind * t * t;
      if (x >= left && x <= right) {
        intersections.push(t);
      }
    }
  }
  
  // 4. BOTTOM EDGE (y = bottom)
  // Solve: y0 + vy*t + 0.5*g*t² = bottom
  const a_bot = 0.5 * gravity;
  const b_bot = vy;
  const c_bot = y0 - bottom;
  const times_bot = solveQuadratic(a_bot, b_bot, c_bot);
  for (const t of times_bot) {
    if (t >= 0) {
      const x = x0 + vx * t + 0.5 * wind * t * t;
      if (x >= left && x <= right) {
        intersections.push(t);
      }
    }
  }
  
  // Return earliest collision time (if any)
  if (intersections.length > 0) {
    return Math.min(...intersections);
  }
  
  return null;
}

/**
 * Solve quadratic equation: a*t² + b*t + c = 0
 * @returns array of real solutions (0, 1, or 2 solutions)
 */
function solveQuadratic(a: number, b: number, c: number): number[] {
  if (Math.abs(a) < 1e-10) {
    // Linear equation: b*t + c = 0
    if (Math.abs(b) < 1e-10) return [];
    return [-c / b];
  }
  
  const discriminant = b * b - 4 * a * c;
  
  if (discriminant < 0) {
    return []; // No real solutions
  }
  
  if (discriminant === 0) {
    return [-b / (2 * a)]; // One solution
  }
  
  // Two solutions
  const sqrt_d = Math.sqrt(discriminant);
  return [
    (-b + sqrt_d) / (2 * a),
    (-b - sqrt_d) / (2 * a)
  ];
}

/**
 * Calculate velocity components from angle and velocity
 */
export function calculateVelocityComponents(angle: number, velocity: number): { vx: number; vy: number } {
  const angleRad = (angle * Math.PI) / 180;
  return {
    vx: velocity * Math.cos(angleRad),
    vy: -velocity * Math.sin(angleRad) // Negative because Y increases downward
  };
}

export function checkTerrainCollision(
  x0: number,
  y0: number,
  vx: number,
  vy: number,
  gravity: number,
  wind: number,
  terrainY: (x: number) => number,
  canvasWidth: number,
  maxTime: number = 10
): number | null {
  const step = 0.01;
  for (let time = step; time <= maxTime; time += step) {
    const x = x0 + vx * time + 0.5 * wind * time * time;
    if (x < 0 || x > canvasWidth) return null;
    const y = y0 + vy * time + 0.5 * gravity * time * time;
    if (y >= terrainY(x)) return time;
  }
  return null;
}

export { checkCastleCollision };