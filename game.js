/* ========================================
   DRIVER DECIDES
   SECURITYPLUS FINANCIAL LITERACY GAME
   Ages 7-10

   CORE LESSON (rebuilt again 2026-09-10, drag rework): needs vs. wants.
   NEED and WANT are the two lanes, always rolling continuously down their
   own side of the road (left/right) - that's just the road's own signage,
   always there. The actual question is a single word that pops up at the
   top of the screen and stays put ("Candy", "Bus Fare", "Kite"...). The
   player DRAGS the scooter left or right, into whichever lane matches -
   wherever it's sitting when time runs out is the answer. Correct = a
   star. Wrong = a gentle on-screen correction - no penalty, no icons, no
   money math.

   This replaces the previous version, where a small icon card physically
   traveled down the center of the road toward the scooter and the scooter
   only jumped between two fixed spots on tap. Kayla's feedback: the
   scooter needs to be genuinely steerable (drag, not tap-to-jump), the
   question should be plain words instead of an icon, and NEED/WANT
   themselves should be the moving/rolling part of the road rather than a
   fixed label - and the "my prize goal" progress bar should go away in
   favor of just watching the star count go up.

   DIFFICULTY BUMP (2026-09-16): which physical side (left/right) NEED and
   WANT land on is now randomized fresh for every single item, instead of
   NEED always being left and WANT always being right. This stops kids
   from just memorizing "left = need" instead of actually reading the
   word each time. See needIsOnLeftThisItem, re-rolled once per item in
   showSignsForCurrentItem().
======================================== */

/* ================= TUNING CONSTANTS ================= */

// How long the NEED/WANT signs take to travel from the horizon down to the
// scooter's row - this IS the decision window now (no separate timer).
// Gets a little faster each round (2026-09-16 pacing pass) so the game
// ramps up rather than staying one flat speed the whole way through.
// Round 1 is deliberately a bit slower than the old flat 4800ms default,
// to ease new players in before the pace ramps up; indexed by
// currentLevelIndex (0-based), with the last value reused as a fallback
// if ROUND_COUNT ever grows past this list.
const ROUND_SIGN_TRAVEL_MS = [5400, 4800, 4200, 3600];

function currentSignTravelMs() {
    return ROUND_SIGN_TRAVEL_MS[currentLevelIndex]
        ?? ROUND_SIGN_TRAVEL_MS[ROUND_SIGN_TRAVEL_MS.length - 1];
}

// Pause after one item resolves before the next word + signs appear.
const GAP_BEFORE_NEXT_MS = 900;

// Safety net only - normally a round ends after all its items have been shown.
const MAX_ITEMS_SAFETY = 40;

// NEED and WANT both travel down together, side by side, once per item -
// starting small and close to center near the horizon (matching how
// narrow the road is up there) and ending big, out in their own lane, by
// the time they reach the scooter.
const SIGN_HORIZON_Y = 30;
const SIGN_COLLISION_Y = 84;
const SIGN_SCALE_FAR = 0.4;
const SIGN_SCALE_NEAR = 2.2;

// Once a sign reaches the scooter's row, it's either the one that got
// caught (see SIGN fly-away below) or it just keeps rolling on down the
// same path it was already on, same as the ambient trees/flowers do, until
// it's clipped out of view by roadSignsLayer's own overflow:hidden edge.
const SIGN_EXIT_Y = 120;

// The road itself is drawn in perspective - narrow near the hill crest,
// wide by the time it reaches the scooter. Rather than sliding each sign
// between two hand-picked x positions (which can drift off the pavement
// wherever that guess doesn't match the art), each sign's x position is
// solved every frame from the road's ACTUAL width at that row: it always
// sits at the same fraction of the way from the centerline out toward its
// own side's edge, so it rides the widening road exactly like the pavement
// does instead of cutting a straight line across it. These two numbers are
// read straight off the background art (sampled at the road's left edge at
// two different heights) - only change them if the background image changes.
const ROAD_EDGE_Y0 = 34;          // % down where the paved road first appears over the hill crest
const ROAD_EDGE_X0 = 45.05;       // road's left-edge x% at that height (right edge mirrors it)
const ROAD_EDGE_X_PER_Y = -0.5642; // how much the left edge moves outward (%) per 1% of y, further down

function roadLeftEdgeX(y) {
    return ROAD_EDGE_X0 + (y - ROAD_EDGE_Y0) * ROAD_EDGE_X_PER_Y;
}

function roadHalfWidthAt(y) {
    return 50 - roadLeftEdgeX(y);
}

/* ================= SHARED SCENERY CAMERA (2026-09-23, per Kayla) =================
   Every piece of ambient scenery (trees, flowers/grass patches, the
   billboard/branch landmarks, and the yellow center-line dashes) is now
   driven by ONE rigid world: each piece has a fixed spot in the world at
   some depth, and a single camera rolls forward through that world at a
   constant speed (SCENE_CAMERA_SPEED). Screen position and size are then
   pure perspective of that depth - y = vanishing point + k/depth, and
   size/sideways offset scale by 1/depth - with the vanishing point read
   straight off the road art's own edges (where the two road edges meet).

   Why: the old version eased each piece's screen position with its own
   t*t curve from its own spawn time (and trees, flowers, dashes and
   landmarks all had different trip lengths). In world terms that meant a
   freshly spawned piece was racing forward while an older one ahead of it
   had nearly stopped - so a billboard that popped up behind a tree could
   visibly close most of the gap and "catch up" to it, which read as the
   scenery moving on its own instead of the scooter moving through it.
   With one shared depth clock, a thing behind can never gain on a thing
   ahead, everything at the same distance moves at the same speed, and
   everything radiates out from the same vanishing point as the road. */
const SCENE_VANISH_Y = ROAD_EDGE_Y0 + (50 - ROAD_EDGE_X0) / ROAD_EDGE_X_PER_Y; // ~25.2%, where the road edges meet
const SCENE_CREST_Y = 33.3075;  // hill line - where scenery first appears
const SCENE_NEAR_Y = 118;       // row where depth = 1 (full "near" size), just past the bottom edge
const SCENE_DEPTH_K = SCENE_NEAR_Y - SCENE_VANISH_Y;

function sceneYAtDepth(depth) {
    return SCENE_VANISH_Y + SCENE_DEPTH_K / depth;
}

function sceneDepthAtY(y) {
    return SCENE_DEPTH_K / (y - SCENE_VANISH_Y);
}

const SCENE_CREST_DEPTH = sceneDepthAtY(SCENE_CREST_Y); // ~11.5

// How long a piece takes to ride from the hill crest to SCENE_NEAR_Y.
// Far-off things barely creep near the crest and then rush past at the
// bottom, like real driving - that's the perspective, not a speed change.
const SCENE_CREST_TO_NEAR_MS = 9500;
const SCENE_CAMERA_SPEED = (SCENE_CREST_DEPTH - 1) / SCENE_CREST_TO_NEAR_MS; // depth units per ms

// Depth of a piece that spawned at the crest `ageMs` ago.
function sceneDepthAtAge(ageMs) {
    return SCENE_CREST_DEPTH - SCENE_CAMERA_SPEED * ageMs;
}

// Age at which a piece spawned at the crest reaches screen row y.
function sceneAgeAtY(y) {
    return (SCENE_CREST_DEPTH - sceneDepthAtY(y)) / SCENE_CAMERA_SPEED;
}

// Everything a roadside piece needs for one frame: screen row, scale
// (1 at SCENE_NEAR_Y, smaller further away), and x solved from a fixed
// world setback beyond the road edge (worldOutset, in % at scale 1) - so
// it rides out along a straight line from the vanishing point like the
// road edge itself does, instead of sliding sideways over the grass.
function sceneRoadsidePlacement(ageMs, worldOutset, isLeft) {
    const depth = sceneDepthAtAge(ageMs);
    const y = sceneYAtDepth(depth);
    const scale = 1 / depth;
    const x = treeLaneX(y, worldOutset * scale, isLeft);
    return { depth, y, scale, x };
}

// How far out into its half of the road each sign sits, as a fraction of
// the road's half-width at that row - kept comfortably inside 1 so the
// sign's own box width never pokes past the grass line even at full size.
const SIGN_LANE_FRACTION = 0.5;

function signLaneX(y, isLeftSide) {
    const half = roadHalfWidthAt(y);
    return isLeftSide ? 50 - SIGN_LANE_FRACTION * half : 50 + SIGN_LANE_FRACTION * half;
}

// Where a sign ends up once it reaches the scooter's row, for each
// physical side of the road - used both to draw the final frame and to
// know how close the scooter has to be parked to actually "catch" it.
// Purely geometric; which category (need/want) lands on which side is
// rolled fresh per item, not fixed here (see needIsOnLeftThisItem).
const SIGN_X_COLLISION_LEFT = signLaneX(SIGN_COLLISION_Y, true);
const SIGN_X_COLLISION_RIGHT = signLaneX(SIGN_COLLISION_Y, false);

// How close to a sign's final lane position the scooter has to be standing
// when the signs arrive to actually "catch" that one. Anything in between -
// the scooter left parked near the middle - is a miss: it never committed
// to a lane, so it doesn't count as picking either need or want.
const CATCH_ZONE_HALF_WIDTH = 12;

// How far the scooter is allowed to drag, in percent of #roadScene width.
// Kept a little short of the true 0/100 edges so it never clips offscreen.
const SCOOTER_MIN_X = 10;
const SCOOTER_MAX_X = 90;


/* ================= GAME STATE ================= */

let stars = 0;
let correctCount = 0;
let wrongCount = 0;
let missCount = 0;
let totalSorted = 0;

let gameRunning = false;

let scooterX = 50;       // percent from left of #roadScene, continuous
let isDragging = false;
let dragPointerId = null;

let currentItem = null;        // the word currently on screen, or null
let nextItemTimer = null;      // gap-before-next-question timeout

// Which physical side NEED lands on for the item currently in play -
// re-rolled fresh each item in showSignsForCurrentItem() (2026-09-16
// randomized-lane difficulty bump). WANT always lands on the other side.
let needIsOnLeftThisItem = true;

// True only during the tutorial's one live practice catch (see the
// TUTORIAL section near the bottom) - resolveItem() checks this and, when
// true, skips all score/round bookkeeping so the practice item never
// counts toward the real game.
let isTutorialDemo = false;

let roadSignAnimFrame = null;  // rAF handle for the current NEED/WANT travel
let roadSignStartTime = null;

// Normally 0 (travel starts its clock at "now"). The tutorial's live demo
// catch (beginTutorialDemoCatch, in the TUTORIAL section) seeds this with
// however much travel time had already elapsed before step 2's pause, so
// resuming continues smoothly instead of restarting from the horizon.
// Consumed (reset to 0) the first time animateRoadSigns reads it.
let roadSignResumeOffsetMs = 0;


/* ================= ROUNDS =================
   Four rounds of 6 items each. All 24 items (12 needs + 12 wants) are
   shuffled together into one deck and dealt out 6-per-round at the start
   of every game, so no item repeats anywhere in the game and each round
   is a random, unpredictable mix of needs and wants (not forced 3/3).
=========================================== */

const ROUND_COUNT = 4;
const ITEMS_PER_ROUND = 6;

// Fisher-Yates - returns a new shuffled array, doesn't mutate the input.
function shuffle(array) {

    const result = array.slice();

    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }

    return result;
}

// Built fresh every time a new game starts (Start button) - ROUND_COUNT
// arrays of ITEMS_PER_ROUND items each, drawn without repeats from the
// full combined need+want deck. Reused as-is across a retry or round
// advance within the same game so items already shown never come back.
let gameRounds = [];
let roundItemIndex = 0;

function buildGameRounds() {

    const deck = shuffle(NEED_ITEMS.concat(WANT_ITEMS));

    gameRounds = [];

    for (let i = 0; i < ROUND_COUNT; i++) {
        gameRounds.push(deck.slice(i * ITEMS_PER_ROUND, (i + 1) * ITEMS_PER_ROUND));
    }
}

let currentLevelIndex = 0;
let levelResults = [];
let finishOutcome = null;  // "retry" | "advance" | "complete"


/* ================= ITEMS =================
   The question is plain text now, not an icon - so each item is just a
   name and a category. Same everyday-purchase set as before.
=========================================== */

const NEED_ITEMS = [
    { name: "School Supplies", category: "need", icon: "images/school-supplies.svg" },
    { name: "Healthy Food", category: "need", icon: "images/healthy-food.svg" },
    { name: "Medicine", category: "need", icon: "images/medicine.svg" },
    { name: "Toothbrush", category: "need", icon: "images/toothbrush.svg" },
    { name: "Backpack", category: "need", icon: "images/backpack.svg" },
    { name: "Glasses", category: "need", icon: "images/glasses.svg" },
    { name: "Soap", category: "need", icon: "images/soap.svg" },
    { name: "Bike Helmet", category: "need", icon: "images/helmet.svg" },
    { name: "Dentist Visit", category: "need", icon: "images/dentist.svg" },
    { name: "Winter Jacket", category: "need", icon: "images/winter-jacket.svg" },
    { name: "Water", category: "need", icon: "images/water.svg" },
    { name: "Groceries", category: "need", icon: "images/groceries.svg" }
];

const WANT_ITEMS = [
    { name: "Candy", category: "want", icon: "images/candy.svg" },
    { name: "Video Games", category: "want", icon: "images/video-games.svg" },
    { name: "Fast Food", category: "want", icon: "images/fast-food.svg" },
    { name: "Trading Cards", category: "want", icon: "images/trading-cards.svg" },
    { name: "Movie Tickets", category: "want", icon: "images/movie-ticket.svg" },
    { name: "Soda", category: "want", icon: "images/soda.svg" },
    { name: "Stickers", category: "want", icon: "images/sticker.svg" },
    { name: "Comic Book", category: "want", icon: "images/comic-book.svg" },
    { name: "Ice Cream", category: "want", icon: "images/ice%20cream.svg" },
    { name: "Fidget Toy", category: "want", icon: "images/fidget-toy.svg" },
    { name: "Theme Park Ticket", category: "want", icon: "images/theme-park.svg" },
    { name: "New Phone Case", category: "want", icon: "images/phone-case.svg" }
];

// The correct-catch star burst that flies from the scooter to the dollars
// card (see spawnCorrectStars()) - same four hand-drawn star shapes as the
// Coin Catch/Lemonade Stand games' star bursts (images/star1-4.svg here,
// inlined so each one's shared #8fcefa fill can be swapped for a random
// brand tone on the fly - see randomStarSVG()).
const STAR_SVGS = [

    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 217.246 216.698"><g><g><path d="M186.93,93.47l-48.54,21.97c-10.19,4.61-18.35,12.77-22.96,22.96l-21.97,48.54-10.11-22.35-6.69-14.78-5.16-11.41c-4.61-10.19-12.77-18.35-22.96-22.96l-15.24-6.9L0,93.47l48.54-21.96c10.19-4.61,18.35-12.77,22.96-22.96L93.46,0l18.61,41.13,3.36,7.42c4.28,9.46,11.62,17.17,20.81,21.91.7.37,1.42.72,2.15,1.05l21.29,9.63,27.25,12.33Z" fill="#8fcefa"/><path d="M186.93,93.47l-48.54,21.97c-10.19,4.61-18.35,12.77-22.96,22.96l-21.97,48.54-10.11-22.35c24.69-47.1,54.91-71.32,76.33-83.45l27.25,12.33Z" fill="#001d3a" opacity=".05"/><path d="M112.07,41.13c-11.02,2.31-28.89,10.68-41.3,39.56-6.68,15.55-23.67,23.69-37.47,27.85L0,93.47l48.54-21.96c10.19-4.61,18.35-12.77,22.96-22.96L93.46,0l18.61,41.13Z" fill="#fff" opacity=".3"/></g><g><path d="M217.246,168.838l-20.85,5.32c-10.65,2.72-18.96,11.04-21.68,21.68l-5.33,20.86-5.32-20.86c-.24-.92-.51-1.83-.83-2.71-1.98-5.5-5.49-10.25-10.04-13.73-3.16-2.42-6.82-4.22-10.81-5.24l-20.85-5.32,20.85-5.33c10.64-2.72,18.96-11.03,21.68-21.68l5.32-20.85,5.33,20.85c.48,1.87,1.13,3.68,1.94,5.39,3.38,7.16,9.48,12.74,17,15.45.89.32,1.81.6,2.74.84l20.85,5.33Z" fill="#8fcefa"/><path d="M217.246,168.838l-20.85,5.32c-10.65,2.72-18.96,11.04-21.68,21.68l-5.33,20.86-5.32-20.86c-.24-.92-.51-1.83-.83-2.71,10.93-15.61,22.05-24.99,30.42-30.46.89.32,1.81.6,2.74.84l20.85,5.33Z" fill="#001d3a" opacity=".05"/><path d="M176.656,147.218c-7.265,2.09-12.868,7.753-13.42,15.45-.53,7.392-3.983,13.937-10.04,16.73-3.16-2.42-6.82-4.22-10.81-5.24l-20.85-5.32,20.85-5.33c10.64-2.72,18.96-11.03,21.68-21.68l5.32-20.85,5.33,20.85c.48,1.87,1.13,3.68,1.94,5.39Z" fill="#fff" opacity=".3"/></g></g></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 186.93 186.94"><g><path d="M186.93,93.47l-48.54,21.97c-10.19,4.61-18.35,12.77-22.96,22.96l-21.97,48.54-10.11-22.35-6.69-14.78-5.16-11.41c-4.61-10.19-12.77-18.35-22.96-22.96l-15.24-6.9L0,93.47l48.54-21.96c10.19-4.61,18.35-12.77,22.96-22.96L93.46,0l18.61,41.13,3.36,7.42c4.28,9.46,11.62,17.17,20.81,21.91.7.37,1.42.72,2.15,1.05l21.29,9.63,27.25,12.33Z" fill="#8fcefa"/><path d="M186.93,93.47l-48.54,21.97c-10.19,4.61-18.35,12.77-22.96,22.96l-21.97,48.54-10.11-22.35c24.69-47.1,54.91-71.32,76.33-83.45l27.25,12.33Z" fill="#001d3a" opacity=".05"/><path d="M112.07,41.13c-11.02,2.31-28.89,10.68-41.3,39.56-6.68,15.55-23.67,23.69-37.47,27.85L0,93.47l48.54-21.96c10.19-4.61,18.35-12.77,22.96-22.96L93.46,0l18.61,41.13Z" fill="#fff" opacity=".3"/></g></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 95.71 95.72"><g><path d="M95.71,47.86l-20.85,5.32c-10.65,2.72-18.96,11.04-21.68,21.68l-5.33,20.86-5.32-20.86c-.24-.92-.51-1.83-.83-2.71-1.98-5.5-5.49-10.25-10.04-13.73-3.16-2.42-6.82-4.22-10.81-5.24L0,47.86l20.85-5.33c10.64-2.72,18.96-11.03,21.68-21.68L47.85,0l5.33,20.85c.48,1.87,1.13,3.68,1.94,5.39,3.38,7.16,9.48,12.74,17,15.45.89.32,1.81.6,2.74.84l20.85,5.33Z" fill="#8fcefa"/><path d="M95.71,47.86l-20.85,5.32c-10.65,2.72-18.96,11.04-21.68,21.68l-5.33,20.86-5.32-20.86c-.24-.92-.51-1.83-.83-2.71,10.93-15.61,22.05-24.99,30.42-30.46.89.32,1.81.6,2.74.84l20.85,5.33Z" fill="#001d3a" opacity=".05"/><path d="M55.12,26.24c-7.265,2.09-12.868,7.753-13.42,15.45-.53,7.392-3.983,13.937-10.04,16.73-3.16-2.42-6.82-4.22-10.81-5.24L0,47.86l20.85-5.33c10.64-2.72,18.96-11.03,21.68-21.68L47.85,0l5.33,20.85c.48,1.87,1.13,3.68,1.94,5.39Z" fill="#fff" opacity=".3"/></g></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 127.419 165.745"><g><g><path d="M95.71,47.86l-20.85,5.32c-10.65,2.72-18.96,11.04-21.68,21.68l-5.33,20.86-5.32-20.86c-.24-.92-.51-1.83-.83-2.71-1.98-5.5-5.49-10.25-10.04-13.73-3.16-2.42-6.82-4.22-10.81-5.24L0,47.86l20.85-5.33c10.64-2.72,18.96-11.03,21.68-21.68L47.85,0l5.33,20.85c.48,1.87,1.13,3.68,1.94,5.39,3.38,7.16,9.48,12.74,17,15.45.89.32,1.81.6,2.74.84l20.85,5.33Z" fill="#8fcefa"/><path d="M95.71,47.86l-20.85,5.32c-10.65,2.72-18.96,11.04-21.68,21.68l-5.33,20.86-5.32-20.86c-.24-.92-.51-1.83-.83-2.71,10.93-15.61,22.05-24.99,30.42-30.46.89.32,1.81.6,2.74.84l20.85,5.33Z" fill="#001d3a" opacity=".05"/><path d="M55.12,26.24c-7.265,2.09-12.868,7.753-13.42,15.45-.53,7.392-3.983,13.937-10.04,16.73-3.16-2.42-6.82-4.22-10.81-5.24L0,47.86l20.85-5.33c10.64-2.72,18.96-11.03,21.68-21.68L47.85,0l5.33,20.85c.48,1.87,1.13,3.68,1.94,5.39Z" fill="#fff" opacity=".3"/></g><g><path d="M127.419,117.886l-20.85,5.32c-10.65,2.72-18.96,11.04-21.68,21.68l-5.33,20.86-5.32-20.86c-.24-.92-.51-1.83-.83-2.71-1.98-5.5-5.49-10.25-10.04-13.73-3.16-2.42-6.82-4.22-10.81-5.24l-20.85-5.32,20.85-5.33c10.64-2.72,18.96-11.03,21.68-21.68l5.32-20.85,5.33,20.85c.48,1.87,1.13,3.68,1.94,5.39,3.38,7.16,9.48,12.74,17,15.45.89.32,1.81.6,2.74.84l20.85,5.33Z" fill="#8fcefa"/><path d="M127.419,117.886l-20.85,5.32c-10.65,2.72-18.96,11.04-21.68,21.68l-5.33,20.86-5.32-20.86c-.24-.92-.51-1.83-.83-2.71,10.93-15.61,22.05-24.99,30.42-30.46.89.32,1.81.6,2.74.84l20.85,5.33Z" fill="#001d3a" opacity=".05"/><path d="M86.829,96.265c-7.265,2.09-12.868,7.753-13.42,15.45-.53,7.392-3.983,13.937-10.04,16.73-3.16-2.42-6.82-4.22-10.81-5.24l-20.85-5.32,20.85-5.33c10.64-2.72,18.96-11.03,21.68-21.68l5.32-20.85,5.33,20.85c.48,1.87,1.13,3.68,1.94,5.39Z" fill="#fff" opacity=".3"/></g></g></svg>'

];

// Same full palette as Coin Catch/Lemonade Stand's randomStarSVG() - one
// blue anchors it back to the brand, then the fully saturated version of
// each secondary color, so a burst reads as a proper rainbow shower
// instead of one hue.
const STAR_TONES = [
    "#258BFF",
    "#FF2525",
    "#FF25BA",
    "#FF9D25",
    "#FFF025",
    "#49FF25",
    "#9D25FF"
];

function randomStarSVG() {

    const template = STAR_SVGS[Math.floor(Math.random() * STAR_SVGS.length)];
    const tone = STAR_TONES[Math.floor(Math.random() * STAR_TONES.length)];

    // Every star in STAR_SVGS shares this one #8fcefa base fill for its
    // main facets - swapping it here recolors the whole star while
    // leaving its dark shadow / white highlight facets (what actually
    // give it its shape) untouched.
    return template.split("#8fcefa").join(tone);
}


/* ================= ELEMENTS ================= */

const game = document.getElementById("game");
const scooter = document.getElementById("scooter");
const roadScene = document.getElementById("roadScene");
const feedbackLayer = document.getElementById("feedbackLayer");
const itemPopup = document.getElementById("itemPopup");
const itemPopupIcon = document.getElementById("itemPopupIcon");
const itemPopupText = document.getElementById("itemPopupText");
const roadSignNeed = document.getElementById("roadSignNeed");
const roadSignWant = document.getElementById("roadSignWant");
const roadSignsLayer = document.getElementById("roadSignsLayer");

// Trees, flowers, and landmarks all spawn into this ONE shared layer (see
// the AMBIENT SCENERY LAYER comment in style.css) so their individual
// progress-based z-index values sort correctly against each other - three
// separate layer divs used to let a whole later layer paint over an
// earlier one's contents regardless of actual depth, which is what caused
// trees/grass to render in front of a landmark they were supposedly
// behind.
const ambientLayer = document.getElementById("ambientLayer");
const roadStripeLayer = document.getElementById("roadStripeLayer");
const groundScrollLayer = document.getElementById("groundScrollLayer");

const starsValueDisplay = document.getElementById("starsValue");
const starsBox = document.getElementById("starsBox");
const starFlightLayer = document.getElementById("starFlightLayer");

const startScreen = document.getElementById("startScreen");
const startButton = document.getElementById("startButton");
const tutorialButton = document.getElementById("tutorialButton");

const finishScreen = document.getElementById("finishScreen");

const tutorialScreen = document.getElementById("tutorialScreen");
const tutorialSpotlight = document.getElementById("tutorialSpotlight");
const tutorialCard = document.getElementById("tutorialCard");
const tutorialTitle = document.getElementById("tutorialTitle");
const tutorialBody = document.getElementById("tutorialBody");
const tutorialNextButton = document.getElementById("tutorialNextButton");
const tutorialSkipButton = document.getElementById("tutorialSkipButton");


/* ================= HELPERS ================= */

function setText(element, value) {
    if (element) {
        element.textContent = value;
    }
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}

// Real perspective isn't linear - something far down a road barely seems to
// move or grow at first, then rushes toward you and balloons in size right
// at the end. Easing the travel progress with a gentle quadratic curve
// before feeding it into position/scale gives the signs that same "small
// and slow, then suddenly big and close" feel instead of growing at a
// constant rate the whole way down.
function easeInPerspective(t) {
    return t * t;
}


/* ================= SCOOTER STEERING (drag) =================
   The scooter is dragged in real time with Pointer Events (covers mouse,
   touch, and pen with one API - important since this runs on a lobby
   touchscreen kiosk). Wherever it sits horizontally when a question
   resolves is the answer: left half of the road = need, right half =
   want. A tap on either lane zone still snaps it there too, as a
   fallback for a kid who taps instead of drags. */

function setScooterX(xPercent) {
    scooterX = Math.max(SCOOTER_MIN_X, Math.min(SCOOTER_MAX_X, xPercent));

    if (scooter) {
        scooter.style.left = scooterX + "%";
    }
}

function getScooterChoice() {
    // The scooter only "catches" a sign if it's actually parked close to
    // that sign's lane by the time the signs arrive. Anything left hanging
    // around the middle never committed to a lane, so it's a miss - not a
    // coin-flip toward whichever half of the road it happens to be nearest.
    // Which category each physical side means is whatever was rolled for
    // this item (needIsOnLeftThisItem) - not a fixed left=need/right=want.
    if (Math.abs(scooterX - SIGN_X_COLLISION_LEFT) <= CATCH_ZONE_HALF_WIDTH) {
        return needIsOnLeftThisItem ? "need" : "want";
    }
    if (Math.abs(scooterX - SIGN_X_COLLISION_RIGHT) <= CATCH_ZONE_HALF_WIDTH) {
        return needIsOnLeftThisItem ? "want" : "need";
    }
    return null;
}

function xPercentFromClientX(clientX) {
    const rect = roadScene.getBoundingClientRect();
    return ((clientX - rect.left) / rect.width) * 100;
}

if (scooter) {

    scooter.addEventListener("pointerdown", function (evt) {

        if (!gameRunning) {
            return;
        }

        isDragging = true;
        dragPointerId = evt.pointerId;

        try {
            scooter.setPointerCapture(dragPointerId);
        } catch (err) {
            // Pointer capture can fail harmlessly on some browsers/devices -
            // dragging still works via the document-level move/up listeners.
        }

        scooter.classList.remove("snap");
        scooter.classList.add("dragging");

        evt.preventDefault();
    });
}

document.addEventListener("pointermove", function (evt) {

    if (!isDragging || evt.pointerId !== dragPointerId) {
        return;
    }

    setScooterX(xPercentFromClientX(evt.clientX));
});

function endDrag(evt) {

    if (!isDragging) {
        return;
    }

    if (evt && evt.pointerId !== undefined && evt.pointerId !== dragPointerId) {
        return;
    }

    isDragging = false;
    dragPointerId = null;

    if (scooter) {
        scooter.classList.remove("dragging");
    }
}

document.addEventListener("pointerup", endDrag);
document.addEventListener("pointercancel", endDrag);

document.querySelectorAll(".laneZone").forEach(function (zone) {

    zone.addEventListener("click", function () {

        if (!gameRunning || isDragging) {
            return;
        }

        // Purely physical left/right - which one is need vs. want this
        // item is handled separately, in getScooterChoice().
        const targetX = zone.dataset.lane === "left" ? 26 : 74;

        if (scooter) {
            scooter.classList.add("snap");
        }

        setScooterX(targetX);

        setTimeout(function () {
            if (scooter) {
                scooter.classList.remove("snap");
            }
        }, 320);
    });
});


/* ================= STARS =================
   "stars" is really a dollar count now - one correct sort = $1 earned -
   just displayed as currency instead of a bare number. */

function updateStars() {
    setText(starsValueDisplay, `$${stars.toFixed(2)}`);
}


/* ================= NEED/WANT ROAD SIGNS =================
   NEED and WANT travel down the road together, side by side, once per
   item - not a continuous decorative loop. They start small and close to
   center near the horizon (matching how narrow the road is up there) and
   arrive full-size over their own lane right as they reach the scooter.
   Their arrival IS the decision deadline: whichever lane the scooter is
   in when they reach the bottom is the answer, so there's no separate
   timer running alongside them. */

function showSignsForCurrentItem() {

    // Re-rolled fresh for every item (2026-09-16 randomized-lane
    // difficulty bump) - left/right can't be memorized as always
    // need/want, the player has to read the word each time.
    needIsOnLeftThisItem = Math.random() < 0.5;

    if (roadSignNeed) {
        roadSignNeed.style.opacity = "1";
    }

    if (roadSignWant) {
        roadSignWant.style.opacity = "1";
    }

    roadSignStartTime = null;
    roadSignAnimFrame = requestAnimationFrame(animateRoadSigns);
}

function animateRoadSigns(timestamp) {

    if (!gameRunning || !currentItem) {
        return;
    }

    if (roadSignStartTime === null) {
        roadSignStartTime = timestamp - roadSignResumeOffsetMs;
        roadSignResumeOffsetMs = 0;
    }

    const elapsed = timestamp - roadSignStartTime;
    const progress = Math.min(1, elapsed / currentSignTravelMs());

    positionRoadSign(roadSignNeed, progress, needIsOnLeftThisItem);
    positionRoadSign(roadSignWant, progress, !needIsOnLeftThisItem);

    if (progress >= 1) {
        resolveItem();
        return;
    }

    roadSignAnimFrame = requestAnimationFrame(animateRoadSigns);
}

function positionRoadSign(el, progress, isLeftSide) {

    if (!el) {
        return;
    }

    const eased = easeInPerspective(progress);
    const y = lerp(SIGN_HORIZON_Y, SIGN_COLLISION_Y, eased);
    // x is solved from the road's real width at this row (see signLaneX)
    // rather than interpolated between two guessed endpoints, so the sign
    // rides the widening pavement instead of cutting a straight line that
    // can drift off it partway down.
    const x = signLaneX(y, isLeftSide);
    const scale = lerp(SIGN_SCALE_FAR, SIGN_SCALE_NEAR, eased);

    el.style.top = y + "%";
    el.style.left = x + "%";
    el.style.transform = `translate(-50%, -50%) scale(${scale.toFixed(3)})`;
}

function hideSigns() {

    if (roadSignNeed) {
        roadSignNeed.style.opacity = "0";
    }

    if (roadSignWant) {
        roadSignWant.style.opacity = "0";
    }
}

/* ================= SIGN CATCH FEEDBACK =================
   The two live #roadSignNeed/#roadSignWant elements only ever represent
   the CURRENT item's signs, still approaching the scooter - the instant
   an item resolves, both of those need to be free again for the next
   item's showSignsForCurrentItem(). So instead of animating the live
   elements any further, each one hands off to its own throwaway clone
   (removed from the DOM once its animation finishes) and the live
   element is hidden right away. That lets the outgoing sign(s) keep
   playing out on their own time without holding up the next item. */

// The sign the player DIDN'T land on just keeps rolling down the same
// path it was already on - same idea as an ambient tree/flower that
// keeps traveling until it's clipped out of view - rather than vanishing
// the instant it arrives.
function continueSignOffScreen(sourceEl, isLeftSide) {

    if (!sourceEl) {
        return;
    }

    const clone = sourceEl.cloneNode(true);
    clone.removeAttribute("id");

    if (roadSignsLayer) {
        roadSignsLayer.appendChild(clone);
    }

    sourceEl.style.opacity = "0";

    const travelMs = currentSignTravelMs();
    const startTime = performance.now();

    function step(timestamp) {

        const elapsed = travelMs + (timestamp - startTime);
        const progress = elapsed / travelMs;
        const eased = easeInPerspective(progress);
        const y = lerp(SIGN_HORIZON_Y, SIGN_COLLISION_Y, eased);

        if (y >= SIGN_EXIT_Y) {
            if (clone.parentNode) {
                clone.parentNode.removeChild(clone);
            }
            return;
        }

        const x = signLaneX(y, isLeftSide);
        const scale = lerp(SIGN_SCALE_FAR, SIGN_SCALE_NEAR, eased);

        clone.style.top = y + "%";
        clone.style.left = x + "%";
        clone.style.transform = `translate(-50%, -50%) scale(${scale.toFixed(3)})`;

        requestAnimationFrame(step);
    }

    requestAnimationFrame(step);
}

// The sign the player DID land on flies straight up and fades out, right
// where it's standing - the same motion the old word-toasts used - with
// the whole box filled green (pop) or red (head-shake) so the color (not a
// sentence) is what actually lands the feedback.
function flyAwaySign(sourceEl, outcome) {

    if (!sourceEl) {
        return;
    }

    const clone = sourceEl.cloneNode(true);
    clone.removeAttribute("id");
    clone.style.setProperty("--catchScale", SIGN_SCALE_NEAR.toFixed(3));
    clone.classList.add(outcome === "correct" ? "roadSign--flyCorrect" : "roadSign--flyWrong");

    if (roadSignsLayer) {
        roadSignsLayer.appendChild(clone);
    }

    sourceEl.style.opacity = "0";

    setTimeout(function () {
        if (clone.parentNode) {
            clone.parentNode.removeChild(clone);
        }
    }, 1150);
}

// Sends each sign off on its own exit animation based on how the item
// resolved: whichever one (if either) the player actually landed on flies
// up and fades with the correct/wrong outline; the other one just keeps
// rolling on down the road untouched, same as the ambient scenery. A miss
// (chosenLane null - the scooter never committed to a lane) means neither
// sign was caught, so both just keep going.
function resolveSignsFeedback(chosenLane, outcome) {

    if (chosenLane === "need") {
        flyAwaySign(roadSignNeed, outcome);
        continueSignOffScreen(roadSignWant, !needIsOnLeftThisItem);
    } else if (chosenLane === "want") {
        flyAwaySign(roadSignWant, outcome);
        continueSignOffScreen(roadSignNeed, needIsOnLeftThisItem);
    } else {
        continueSignOffScreen(roadSignNeed, needIsOnLeftThisItem);
        continueSignOffScreen(roadSignWant, !needIsOnLeftThisItem);
    }
}


/* ================= AMBIENT BACKGROUND MOTION =================
   2026-09-16 perspective pass. Feedback from a playtest: with only the
   NEED/WANT signs growing as they travel, and literally everything else
   in the scene (road, grass, trees) sitting frozen, the signs read as
   objects being thrown AT the player rather than the player driving
   forward down a road - there was nothing else on screen confirming "the
   world is moving," so the signs had no context.

   Fix: two continuous, purely decorative spawners - roadside trees and
   center-line dashes - that plant something small up at the hill crest
   and travel/grow it down toward the bottom using the exact same
   easeInPerspective curve already used for the signs (see positionRoadSign
   above). With the scenery itself now receding-to-approaching in sync
   with the signs, the whole scene reads as one moving world instead of
   objects flying at the camera.

   Both run forever from page load, independent of gameRunning/round state
   - same as the sun/cloud drift already did - so the road already feels
   alive behind the start screen, tutorial, and finish screen, not just
   during active play. Neither is ever stopped or reset by resetGame() /
   startTutorial() / etc. - there's nothing for them to interact with,
   they just keep spawning and recycling elements underneath everything
   else for the life of the page. */

// --- Roadside trees ---
// Alternates sides on every spawn. x is solved from the road's real left
// edge at that row (roadLeftEdgeX, same formula the signs use to stay ON
// the pavement) plus an outward margin that grows the deeper the tree
// gets - so trees are always planted a clear gap out into the grass
// instead of hugging the shoulder (which read as "static," like they'd
// been dropped right next to the road rather than passing scenery).
// Both the travel distance and outward margin deliberately run well past
// the visible frame (GROUND_Y past 100%, OUTSET_NEAR far past the edge)
// so a tree is fully clipped out of view by #roadScene's overflow:hidden
// before it's ever removed from the DOM - it slides all the way off
// instead of popping away while still on screen.
// Matches GROUND_BAND_TOP (the hill line, 24.5829% + 8.7246% - hills were
// slid up in style.css to meet the fixed road position, so this moved up
// with them) - trees now start right where the grass does instead of
// fading in a few points higher, which used to read as trees growing in
// over the hill artwork itself rather than out of the grass beside the
// road.
// 2026-09-23: positions/sizes now come from the shared scenery camera
// (see SHARED SCENERY CAMERA near the top) - these are world values,
// i.e. what they measure at full near size (SCENE_NEAR_Y).
const TREE_OUTSET = 28;       // % beyond the road edge, at near size
// Extra random scatter on top of the growing offset above, fixed per tree
// for its whole trip (same idea as FLOWER_JITTER_MAX below) - without this,
// every tree at a given depth sits at the exact same distance from the
// road, which reads as a mechanical row hugging the shoulder instead of
// trees actually out in the field. Skewed so it can only ever push a tree
// further FROM the road (0 to +max), never toward it - a negative jitter
// would fight the base offset and risk landing a tree back on the road
// shoulder right where it just eased away from it.
const TREE_JITTER_MAX = 38;

// 2026-09-23 (Kayla: "all the trees are right on the edge of the road,
// some have to be further out"): with true perspective, a tree's whole
// setback shrinks toward the vanishing point with distance, so a
// 0-38 jitter alone kept every far tree pinned beside the road. Each tree
// now rolls a setback from one of three bands so the field has depth
// sideways too: some line the road, some sit out in the field, and some
// are way out - those drift off the side of the screen partway down
// (like real roadside scenery does) instead of passing right by you.
// Values are extra setback beyond TREE_OUTSET, at near size.
const TREE_SETBACK_BANDS = [
    { weight: 0.40, min: 0,   max: 30  },  // along the road
    { weight: 0.35, min: 45,  max: 120 },  // out in the field
    { weight: 0.25, min: 150, max: 300 }   // far out
];

function pickTreeSetback() {
    let r = Math.random();
    for (const band of TREE_SETBACK_BANDS) {
        if (r < band.weight) {
            return band.min + Math.random() * (band.max - band.min);
        }
        r -= band.weight;
    }
    return 0;
}
const TREE_WIDTH_NEAR = 26;   // % of #roadScene width at near size
const TREE_SPAWN_INTERVAL_MS = 1300; // 2026-09-23: tuned with TREE_SETBACK_BANDS below // 2026-09-23: was 950 - with the longer shared-camera trip that crowded the hill line

function treeLaneX(y, outset, isLeftSide) {
    return isLeftSide ? roadLeftEdgeX(y) - outset : (100 - roadLeftEdgeX(y)) + outset;
}

let treeSpawnNextIsLeft = true;
let activeTrees = [];       // { el, isLeft, jitter, startTime }
let treeSpawnTimer = null;
let treeAnimFrame = null;

function startTreeAmbience() {

    if (!ambientLayer || treeSpawnTimer) {
        return;
    }

    spawnAmbientTree();
    treeSpawnTimer = setInterval(spawnAmbientTree, TREE_SPAWN_INTERVAL_MS);
    treeAnimFrame = requestAnimationFrame(tickAmbientTrees);
}

// preAgeMs/forceLeft are only used by prefillAmbientScenery() - it plants
// trees as if the spawner had already been running, so the road starts
// out full instead of empty with everything bunched at the hill line.
function spawnAmbientTree(preAgeMs, forceLeft) {

    const isPrefill = typeof preAgeMs === "number";

    if (ambientPaused && !isPrefill) {
        return;
    }

    let isLeft;
    if (isPrefill) {
        isLeft = forceLeft;
    } else {
        isLeft = treeSpawnNextIsLeft;
        treeSpawnNextIsLeft = !treeSpawnNextIsLeft;
    }

    const spot = document.createElement("div");
    spot.className = "treeSpot";

    const img = document.createElement("img");
    img.className = "treeDecor";
    img.src = "images/tree.svg";
    img.alt = "";
    // A little random sway timing per tree so a whole flight of them
    // never sways in lockstep.
    img.style.animationDuration = (3.4 + Math.random() * 1.0).toFixed(2) + "s";
    img.style.animationDelay = "-" + (Math.random() * 3).toFixed(2) + "s";

    spot.appendChild(img);
    ambientLayer.appendChild(spot);

    // Random but fixed for this tree's whole trip, so it settles into its
    // own spot out in the grass instead of drifting sideways as it travels.
    const jitter = pickTreeSetback();

    const tree = { el: spot, isLeft, jitter, startTime: null, preAge: isPrefill ? preAgeMs : 0 };
    activeTrees.push(tree);
    placeAmbientTree(tree, tree.preAge);
}

function placeAmbientTree(tree, elapsed) {
    const place = sceneRoadsidePlacement(elapsed, TREE_OUTSET + tree.jitter, tree.isLeft);
    // Size comes from the same depth as position (1/depth), so it only
    // ever reflects how close the tree really is.
    tree.el.style.left = place.x + "%";
    tree.el.style.top = place.y + "%";
    tree.el.style.width = (TREE_WIDTH_NEAR * place.scale) + "%";
    // Stack closer (bigger) trees above farther ones - spawn/DOM order
    // alone would let a newer, farther tree paint over an older, closer one.
    tree.el.style.zIndex = Math.round(place.scale * 1000);
    return place;
}

function tickAmbientTrees(timestamp) {

    // Frozen in place while paused (tutorial popups) - see
    // pauseAmbientMotion(). The clock is shifted by the total paused time
    // so everything picks up exactly where it stopped on resume.
    if (ambientPaused) {
        treeAnimFrame = requestAnimationFrame(tickAmbientTrees);
        return;
    }
    timestamp -= ambientPausedTotalMs;

    for (let i = activeTrees.length - 1; i >= 0; i--) {

        const tree = activeTrees[i];

        if (tree.startTime === null) {
            tree.startTime = timestamp - tree.preAge;
        }

        const place = placeAmbientTree(tree, timestamp - tree.startTime);

        if (place.depth <= 1) {
            tree.el.remove();
            activeTrees.splice(i, 1);
        }
    }

    treeAnimFrame = requestAnimationFrame(tickAmbientTrees);
}

// --- Roadside landmarks (billboard + credit union branch) ---
// 2026-09-21 client feedback: an occasional billboard and credit union
// branch building should pass by in the background, using this same
// travel/perspective-growth dynamic as the trees above - but far more
// rarely. Reuses TREE_HORIZON_Y/TREE_GROUND_Y (the exact same hill line
// and bottom edge the trees/flowers already travel between) and
// treeLaneX (the same road-edge-relative positioning formula), so a
// landmark eases down the same path a tree would, just set back a bit
// further from the shoulder (bigger OUTSET figures) since these are meant
// to read as set-piece background scenery, not roadside foliage.
// Alternates asset (billboard, then branch, then billboard again...) each
// time one spawns, so both eventually show up without ever doubling up on
// the same one twice in a row. Spawn interval is deliberately huge next to
// TREE_SPAWN_INTERVAL_MS (1300) / FLOWER_SPAWN_INTERVAL_MS (750) - this is
// a "every once in a while" flourish, not steady scenery.
// Per-asset size (2026-09-24): the new SP-Branch.svg is wide and short
// (~2:1), so at the billboard's width it read small - it gets a 1.25x
// width, plus a little extra setback so its wider footprint still clears
// the road edge. Filename case must match the file exactly (web hosts are
// case-sensitive even though Windows isn't).
const LANDMARK_ASSETS = [
    { src: "images/SP-billboard.svg", widthMult: 1,    extraOutset: 0 },
    { src: "images/SP-Branch.svg",    widthMult: 1.25, extraOutset: 6 }
];
// Kept noticeably more conservative than TREE_OUTSET_FAR/NEAR and
// TREE_JITTER_MAX - a tree that happens to roll max jitter and drifts
// off-frame early is invisible in a dense stream of them, but a landmark
// is the only prominent thing on screen when it appears, so it needs to
// stay comfortably inside the visible frame through most of its trip
// instead of clipping out early. It's still expected to eventually exit
// past the frame edge right at the very end, same as the trees do - that
// reads as "passing by close up," not a bug.
const LANDMARK_OUTSET = 22;       // % beyond the road edge at near size (shared scenery camera)
const LANDMARK_JITTER_MAX = 12;   // same idea as TREE_JITTER_MAX - random extra setback, fixed per landmark for its whole trip
const LANDMARK_WIDTH_NEAR = 44;   // % of #roadScene width at near size
const LANDMARK_SPAWN_INTERVAL_MS = 15000;  // ~15s between landmarks - rare, not ambient filler

let landmarkSpawnNextIsLeft = true;
let landmarkSpawnNextAssetIndex = 0;
let activeLandmarks = [];   // { el, isLeft, jitter, startTime }
let landmarkSpawnTimer = null;
let landmarkAnimFrame = null;

function startLandmarkAmbience() {

    if (!ambientLayer || landmarkSpawnTimer) {
        return;
    }

    // Unlike the trees/flowers, deliberately no immediate spawnAmbientLandmark()
    // call here - the first billboard/branch should ease in after a normal
    // wait like any other, not greet the player the instant the page loads.
    landmarkSpawnTimer = setInterval(spawnAmbientLandmark, LANDMARK_SPAWN_INTERVAL_MS);
    landmarkAnimFrame = requestAnimationFrame(tickAmbientLandmarks);
}

function spawnAmbientLandmark() {

    if (ambientPaused) {
        return;
    }

    const isLeft = landmarkSpawnNextIsLeft;
    landmarkSpawnNextIsLeft = !landmarkSpawnNextIsLeft;

    const asset = LANDMARK_ASSETS[landmarkSpawnNextAssetIndex];
    landmarkSpawnNextAssetIndex = (landmarkSpawnNextAssetIndex + 1) % LANDMARK_ASSETS.length;

    const spot = document.createElement("div");
    spot.className = "landmarkSpot";

    const img = document.createElement("img");
    img.className = "landmarkDecor";
    img.src = asset.src;
    img.alt = "";

    spot.appendChild(img);
    ambientLayer.appendChild(spot);

    // Random but fixed for this landmark's whole trip, same idea as the
    // trees' jitter - keeps every billboard/branch from planting at the
    // exact same distance from the road every time.
    const jitter = Math.random() * LANDMARK_JITTER_MAX;

    activeLandmarks.push({ el: spot, isLeft, jitter, widthMult: asset.widthMult, extraOutset: asset.extraOutset, startTime: null });
}

function tickAmbientLandmarks(timestamp) {

    // Frozen in place while paused (tutorial popups) - see
    // pauseAmbientMotion(). The clock is shifted by the total paused time
    // so everything picks up exactly where it stopped on resume.
    if (ambientPaused) {
        landmarkAnimFrame = requestAnimationFrame(tickAmbientLandmarks);
        return;
    }
    timestamp -= ambientPausedTotalMs;

    for (let i = activeLandmarks.length - 1; i >= 0; i--) {

        const landmark = activeLandmarks[i];

        if (landmark.startTime === null) {
            landmark.startTime = timestamp;
        }

        const elapsed = timestamp - landmark.startTime;
        const place = sceneRoadsidePlacement(elapsed, LANDMARK_OUTSET + landmark.extraOutset + landmark.jitter, landmark.isLeft);
        const y = place.y;
        const x = place.x;
        const width = LANDMARK_WIDTH_NEAR * landmark.widthMult * place.scale;

        landmark.el.style.left = x + "%";
        landmark.el.style.top = y + "%";
        landmark.el.style.width = width + "%";
        // Same depth-stacking fix as the trees - keeps a landmark that's
        // gotten big and close from ever painting behind one still small
        // and distant, regardless of spawn order.
        landmark.el.style.zIndex = Math.round(place.scale * 1000);

        if (place.depth <= 1) {
            landmark.el.remove();
            activeLandmarks.splice(i, 1);
        }
    }

    landmarkAnimFrame = requestAnimationFrame(tickAmbientLandmarks);
}

// --- Center-line dashes ---
// The road's vanishing point sits dead center, so unlike the trees/signs
// this needs no per-row x formula at all - every dash just travels
// straight down a flat 50% left. GROUND_Y runs well past 100% for the
// same reason as the trees above - fully clipped out of view before
// removal, not popped away mid-screen. Spawn interval is deliberately
// tighter than the travel duration so several dashes are always in
// flight at once - a proper dashed line, not one dash at a time.
// Matches the road's own fixed top edge (33.3075%, see .bg-layer--road in
// style.css) - dashes begin exactly where the road surface itself starts,
// instead of above it. Same figure as GROUND_BAND_TOP/TREE_HORIZON_Y,
// since hills were slid up in style.css to meet this same line.
// 2026-09-23: dashes ride the shared scenery camera too (see SHARED
// SCENERY CAMERA), so the road's own markings pass at exactly the same
// speed as the trees/grass beside them. Each dash is a real strip of
// road DASH_DEPTH_LENGTH deep, so it's drawn from its near edge to its
// far edge - naturally squashed thin up at the crest and long up close.
const DASH_WIDTH_NEAR = 2.35;      // % of #roadScene width at near size
const DASH_DEPTH_LENGTH = 0.2;     // dash length in depth units
const DASH_MIN_HEIGHT = 0.25;      // keep the farthest dashes from vanishing to nothing
// Retired once its far (top) edge has passed the bottom of the frame.
const DASH_TRAVEL_MS = (SCENE_CREST_DEPTH - DASH_DEPTH_LENGTH - sceneDepthAtY(100)) / SCENE_CAMERA_SPEED;

// Screen rect of a dash whose far edge left the crest ageMs ago.
function dashPlacementAtAge(ageMs) {
    const farDepth = sceneDepthAtAge(ageMs);
    const nearDepth = Math.max(0.05, farDepth - DASH_DEPTH_LENGTH);
    const top = sceneYAtDepth(farDepth);
    const bottom = sceneYAtDepth(nearDepth);
    const height = Math.max(DASH_MIN_HEIGHT, bottom - top);
    return {
        y: top + height / 2,  // .ambientDash is centered on its point
        height,
        width: DASH_WIDTH_NEAR * (2 / (farDepth + nearDepth))
    };
}
const DASH_SPAWN_INTERVAL_MS = 500;  // with the shared camera speed, leaves a gap ~1.75x a dash

let activeDashes = [];      // { el, startTime }
let dashSpawnTimer = null;
let dashAnimFrame = null;

function startRoadStripeAmbience() {

    if (!roadStripeLayer || dashSpawnTimer) {
        return;
    }

    spawnAmbientDash();
    dashSpawnTimer = setInterval(spawnAmbientDash, DASH_SPAWN_INTERVAL_MS);
    dashAnimFrame = requestAnimationFrame(tickAmbientDashes);
}

function spawnAmbientDash() {

    if (ambientPaused) {
        return;
    }

    const el = document.createElement("div");
    el.className = "ambientDash";
    roadStripeLayer.appendChild(el);

    activeDashes.push({ el, startTime: null });
}

function tickAmbientDashes(timestamp) {

    // Frozen in place while paused (tutorial popups) - see
    // pauseAmbientMotion(). The clock is shifted by the total paused time
    // so everything picks up exactly where it stopped on resume.
    if (ambientPaused) {
        dashAnimFrame = requestAnimationFrame(tickAmbientDashes);
        return;
    }
    timestamp -= ambientPausedTotalMs;

    for (let i = activeDashes.length - 1; i >= 0; i--) {

        const dash = activeDashes[i];

        if (dash.startTime === null) {
            dash.startTime = timestamp;
        }

        const elapsed = timestamp - dash.startTime;
        const place = dashPlacementAtAge(elapsed);

        dash.el.style.top = place.y + "%";
        dash.el.style.width = place.width + "%";
        dash.el.style.height = place.height + "%";

        if (elapsed >= DASH_TRAVEL_MS) {
            dash.el.remove();
            activeDashes.splice(i, 1);
        }
    }

    dashAnimFrame = requestAnimationFrame(tickAmbientDashes);
}

// --- Scrolling ground (light/dark grass tiles) ---
// 2026-09-16 art breakdown: Kayla split the background into separate
// pieces, including two grass tiles (light = further/near the hills,
// dark = closer/foreground) meant to sit beside the road and scroll
// continuously, so the ground itself reads as moving instead of just the
// signs/trees.
//
// This deliberately does NOT track each tile's own ever-increasing
// absolute position (two earlier versions tried that - one with a global
// modulo offset per tile, one with a recycle-to-the-back queue - and both
// let the whole chain drift arbitrarily far from the visible band over
// time, which either opened a gap that only "snapped" shut once a full
// cycle had elapsed, or eventually recycled tiles to positions that were
// themselves already off past the bottom, permanently emptying the
// visible band). Instead there's a single small, BOUNDED scroll amount
// (0 up to one light+dark pair's height, then it wraps) that says how far
// into the current pair we are, and every frame the visible sequence of
// tiles is walked fresh from that - light, dark, light, dark... - filling
// downward from the hill line until past the bottom of the frame. A small
// reusable pool of <img> elements is repositioned/retyped to match; any
// pool elements not needed this frame are just hidden. This can never
// drift, because nothing is ever added to an already-large number - the
// scroll amount is recomputed from elapsed time and wrapped every frame.
const GROUND_TILE_TYPES = [
    { src: "images/lightgrass.svg", heightPct: 30.7668, color: "#7ecc5a" }, // 332.281 / 1080
    { src: "images/dark grass.svg", heightPct: 38.4640, color: "#70bc52" }  // 415.412 / 1080
];

const GROUND_PATTERN_HEIGHT = GROUND_TILE_TYPES.reduce((sum, t) => sum + t.heightPct, 0);

// How far below the hill line the ground band starts - matches
// .bg-layer--hills' top + height (24.5829% + 8.7246%). Hills were slid up
// in style.css to meet the road's own fixed top edge (33.3075%) instead of
// the road being moved down to meet them, so this line is the road's top
// edge too now - same figure, same purpose either way.
const GROUND_BAND_TOP = 33.3075;

// Pool size - just needs to be enough to ever cover from one pattern-
// height above the band top down past the bottom of the frame in one
// pass; the visible band is ~54.3% tall, a pattern is 69.2% tall, so in
// the worst case that's under 5 tiles. A little extra headroom is cheap.
// 2026-09-23: bumped for the perspective layout below - far-off stripes
// get thin up near the hill line, so many more fit on screen at once.
const GROUND_TILE_POOL_SIZE = 24;

// Deliberate overlap on every tile - see the note where it's used below.
// Sized generously: dark grass.svg's top edge is a wavy shape, not a flat
// rectangle, and pixel-measuring the actual asset shows its transparent
// sliver reaches about 2.32% of the scene's height deep at its worst
// point before the fill starts, so a mere rounding-error-sized nudge
// isn't enough to hide it - this needs to clear that with room to spare.
//
// Belt-and-suspenders: even with this overlap, each tile is painted with
// its own matching green as a CSS background-color behind the SVG (see
// tickGroundScroll below), so any transparent sliver anywhere in the
// artwork - top, bottom, or a spot never measured - shows through to a
// green that blends in, never to the page's blue background.
const GROUND_TILE_OVERLAP = 3;

// 2026-09-23 (Kayla: "the grass seems to be coming in at a different
// pace"): the grass stripes now ride the SAME shared scenery camera as the
// trees/flowers/dashes (see SHARED SCENERY CAMERA). Each light/dark stripe
// is a fixed strip of ground GROUND_STRIPE_DEPTH[type] deep; the camera
// rolls over them at SCENE_CAMERA_SPEED, and each stripe's top/bottom
// edges are just sceneYAtDepth() of its far/near edge. So stripes are thin
// and slow up by the hills and tall and fast near the scooter - exactly
// matching whatever tree or flower is standing on them. (Replaces the old
// flat, constant-speed scroll, GROUND_SCROLL_MS_PER_PAIR = 15000.)
// Same light:dark proportion as the original tile heights.
const GROUND_STRIPE_PAIR_DEPTH = 1.6;
const GROUND_STRIPE_DEPTH = GROUND_TILE_TYPES.map(t => GROUND_STRIPE_PAIR_DEPTH * t.heightPct / GROUND_PATTERN_HEIGHT);
// Stop laying stripes once they're this close (well past the bottom edge).
const GROUND_STRIPE_MIN_DEPTH = 0.6;

// Lays the whole ground band out for a camera that has rolled
// `cameraTravel` depth units since the ride began. Pure function of that
// one number (wrapped by the pattern length), so it can never drift.
function layoutGroundTiles(cameraTravel) {

    const P = GROUND_STRIPE_PAIR_DEPTH;
    const L0 = GROUND_STRIPE_DEPTH[0];

    // World position (along the road) currently sitting at the hill crest,
    // and the stripe that contains it. Stripe pattern repeats every P:
    // [start, start+L0) is light, [start+L0, start+P) is dark.
    const crestWorld = SCENE_CREST_DEPTH + cameraTravel;
    const phase = ((crestWorld % P) + P) % P;
    let patternStart = crestWorld - phase;
    let typeIndex = phase < L0 ? 0 : 1;

    let poolIndex = 0;

    while (poolIndex < groundTilePool.length) {

        const worldNear = patternStart + (typeIndex === 0 ? 0 : L0);
        const worldFar = worldNear + GROUND_STRIPE_DEPTH[typeIndex];
        const nearDepth = worldNear - cameraTravel;
        const farDepth = worldFar - cameraTravel;

        if (farDepth <= GROUND_STRIPE_MIN_DEPTH) {
            break;
        }

        const top = sceneYAtDepth(farDepth);
        const bottom = sceneYAtDepth(Math.max(GROUND_STRIPE_MIN_DEPTH, nearDepth));
        const height = bottom - top;

        const type = GROUND_TILE_TYPES[typeIndex];
        const tileEl = groundTilePool[poolIndex];

        if (tileEl.dataset.src !== type.src) {
            tileEl.style.backgroundImage = 'url("' + type.src + '")';
            tileEl.style.backgroundColor = type.color;
            tileEl.dataset.src = type.src;
        }
        tileEl.style.display = "block";
        // Extend every tile up a little (see GROUND_TILE_OVERLAP) so no
        // sub-pixel seam shows between neighbors - scaled to the stripe's
        // own height now, so a big near stripe can't swallow the thin far
        // stripes above it.
        const overlap = Math.min(GROUND_TILE_OVERLAP, height * 0.08 + 0.2);
        tileEl.style.top = (top - overlap) + "%";
        tileEl.style.height = (height + overlap) + "%";

        poolIndex++;

        if (bottom >= 100) {
            break;
        }

        // Next stripe down the screen = the next one nearer the camera.
        if (typeIndex === 1) {
            typeIndex = 0;
        } else {
            typeIndex = 1;
            patternStart -= P;
        }
    }

    for (; poolIndex < groundTilePool.length; poolIndex++) {
        groundTilePool[poolIndex].style.display = "none";
    }
}

let groundTilePool = [];       // reusable <img> elements
let groundScrollStartTime = null;
let groundScrollAnimFrame = null;

function startGroundScrollAmbience() {

    // Guards on groundScrollAnimFrame now, not groundTilePool.length -
    // placeStaticGroundTiles() (pre-game static grass, see below) already
    // populates groundTilePool up front, so pool length alone can no
    // longer tell "already animating" apart from "just statically drawn
    // once and waiting." groundScrollAnimFrame only gets set once the RAF
    // loop actually starts, which is the real "already running" signal.
    if (!groundScrollLayer || groundScrollAnimFrame) {
        return;
    }

    if (!groundTilePool.length) {
        for (let i = 0; i < GROUND_TILE_POOL_SIZE; i++) {
            // A div with the artwork as a CSS background (not an <img>), so
            // a matching green background-color can sit directly behind it
            // - see the note on GROUND_TILE_OVERLAP above for why.
            const tile = document.createElement("div");
            tile.className = "groundTile";
            groundScrollLayer.appendChild(tile);
            groundTilePool.push(tile);
        }
    }

    groundScrollAnimFrame = requestAnimationFrame(tickGroundScroll);
}

function tickGroundScroll(timestamp) {

    // Frozen in place while paused (tutorial popups) - see
    // pauseAmbientMotion(). The clock is shifted by the total paused time
    // so everything picks up exactly where it stopped on resume.
    if (ambientPaused) {
        groundScrollAnimFrame = requestAnimationFrame(tickGroundScroll);
        return;
    }
    timestamp -= ambientPausedTotalMs;

    if (groundScrollStartTime === null) {
        groundScrollStartTime = timestamp;
    }

    const elapsed = timestamp - groundScrollStartTime;
    // Wrapped to one pattern length so the number never grows unbounded.
    layoutGroundTiles((elapsed * SCENE_CAMERA_SPEED) % GROUND_STRIPE_PAIR_DEPTH);

    groundScrollAnimFrame = requestAnimationFrame(tickGroundScroll);
}

// --- Flowers + grass patches (extra roadside detail) ---
// Same travel-and-recycle technique as the trees, just smaller and
// scattered more loosely across the grass (a random outward jitter on
// top of the usual growing offset) rather than lined up right at the
// road edge, so it reads as sprinkled detail rather than a second row of
// trees.
const FLOWER_ASSETS = ["images/flowerwhite.svg", "images/floweryellow.svg", "images/grasspatch.svg"];
const PATCH_ASSET = "images/grasspatch.svg";
// Matches TREE_HORIZON_Y/GROUND_BAND_TOP - same hill-line horizon as
// everything else roadside, so flowers don't fade in over the hill art.
// 2026-09-23: rides the shared scenery camera (see SHARED SCENERY CAMERA);
// values below are at near size.
const FLOWER_OUTSET = 22;
const FLOWER_JITTER_MAX = 26; // extra random scatter, fixed per flower for its whole trip
// Same idea as TREE_SETBACK_BANDS - some flowers/patches scattered well out
// in the field instead of every one hugging the road.
const FLOWER_FAR_CHANCE = 0.45;
const FLOWER_FAR_MIN = 40;
const FLOWER_FAR_MAX = 220;
// Flowers and grass patches share the same travel/outset curve above, but
// grow to different caps: flowers stay small sprinkled detail, while grass
// patches (being a flatter, ground-level shape rather than a little bloom)
// can read fine a bit bigger without looking out of place.
const FLOWER_WIDTH_NEAR = 4;    // % of #roadScene width at near size
const PATCH_WIDTH_NEAR = 8;

// Fixed world setback for one flower/patch. Floored at half its own width
// (plus a margin) so the whole shape - not just its center - always
// clears the road; road paints on top (z-index 3 vs 2), so anything
// overlapping it would be cut off. Since width and setback both scale by
// the same 1/depth now, checking it once at near size holds for the
// whole trip.
function flowerWorldOutset(jitter, isPatch) {
    const widthNear = isPatch ? PATCH_WIDTH_NEAR : FLOWER_WIDTH_NEAR;
    return Math.max(widthNear / 2 + 1, FLOWER_OUTSET + jitter);
}
const FLOWER_SPAWN_INTERVAL_MS = 750; // 2026-09-23: was 560, thinned out with the trees

let flowerSpawnNextIsLeft = true;
let activeFlowers = [];     // { el, isLeft, jitter, startTime }
let flowerSpawnTimer = null;
let flowerAnimFrame = null;

function startFlowerAmbience() {

    if (!ambientLayer || flowerSpawnTimer) {
        return;
    }

    spawnAmbientFlower();
    flowerSpawnTimer = setInterval(spawnAmbientFlower, FLOWER_SPAWN_INTERVAL_MS);
    flowerAnimFrame = requestAnimationFrame(tickAmbientFlowers);
}

// Same prefill options as spawnAmbientTree().
function spawnAmbientFlower(preAgeMs, forceLeft) {

    const isPrefill = typeof preAgeMs === "number";

    if (ambientPaused && !isPrefill) {
        return;
    }

    let isLeft;
    if (isPrefill) {
        isLeft = forceLeft;
    } else {
        isLeft = flowerSpawnNextIsLeft;
        flowerSpawnNextIsLeft = !flowerSpawnNextIsLeft;
    }

    const spot = document.createElement("div");
    spot.className = "flowerSpot";

    const src = FLOWER_ASSETS[Math.floor(Math.random() * FLOWER_ASSETS.length)];
    const isPatch = src === PATCH_ASSET;

    const img = document.createElement("img");
    img.className = "flowerDecor";
    img.src = src;
    img.alt = "";

    spot.appendChild(img);
    ambientLayer.appendChild(spot);

    // Random but fixed for this flower's whole trip, so it settles into
    // its own "lane" out in the grass instead of drifting.
    const jitter = Math.random() < FLOWER_FAR_CHANCE
        ? FLOWER_FAR_MIN + Math.random() * (FLOWER_FAR_MAX - FLOWER_FAR_MIN)
        : (Math.random() * 2 - 1) * FLOWER_JITTER_MAX;

    const flower = { el: spot, isLeft, jitter, isPatch, startTime: null, preAge: isPrefill ? preAgeMs : 0 };
    activeFlowers.push(flower);
    placeAmbientFlower(flower, flower.preAge);
}

function placeAmbientFlower(flower, elapsed) {
    const place = sceneRoadsidePlacement(elapsed, flowerWorldOutset(flower.jitter, flower.isPatch), flower.isLeft);
    flower.el.style.left = place.x + "%";
    flower.el.style.top = place.y + "%";
    flower.el.style.width = ((flower.isPatch ? PATCH_WIDTH_NEAR : FLOWER_WIDTH_NEAR) * place.scale) + "%";
    // Same depth-stacking fix as the trees.
    flower.el.style.zIndex = Math.round(place.scale * 1000);
    return place;
}

function tickAmbientFlowers(timestamp) {

    // Frozen in place while paused (tutorial popups) - see
    // pauseAmbientMotion(). The clock is shifted by the total paused time
    // so everything picks up exactly where it stopped on resume.
    if (ambientPaused) {
        flowerAnimFrame = requestAnimationFrame(tickAmbientFlowers);
        return;
    }
    timestamp -= ambientPausedTotalMs;

    for (let i = activeFlowers.length - 1; i >= 0; i--) {

        const flower = activeFlowers[i];

        if (flower.startTime === null) {
            flower.startTime = timestamp - flower.preAge;
        }

        const place = placeAmbientFlower(flower, timestamp - flower.startTime);

        if (place.depth <= 1) {
            flower.el.remove();
            activeFlowers.splice(i, 1);
        }
    }

    flowerAnimFrame = requestAnimationFrame(tickAmbientFlowers);
}

// --- Static pre-game GROUND (grass) tiles ---
// Same idea as the trees/flowers below, for the ground-scroll layer
// (see startGroundScrollAmbience/tickGroundScroll above) - that system
// builds its whole tile pool lazily on first start, so leaving it fully
// deferred left the grass band completely blank pre-game, not just
// unmoving. This draws exactly what tickGroundScroll's own first frame
// (elapsed === 0) would draw, using the SAME groundTilePool array -
// startGroundScrollAmbience() sees tiles already in that pool and skips
// straight to animating, and that first real tick is elapsed === 0 too,
// so it recomputes this exact layout before advancing - no jump.
function placeStaticGroundTiles() {

    if (!groundScrollLayer || groundTilePool.length) {
        return;
    }

    for (let i = 0; i < GROUND_TILE_POOL_SIZE; i++) {
        const tile = document.createElement("div");
        tile.className = "groundTile";
        groundScrollLayer.appendChild(tile);
        groundTilePool.push(tile);
    }

    layoutGroundTiles(0);
}

// --- Static pre-game scenery (2026-09-22, per Kayla) ---
// The road shouldn't be bare while it's frozen behind the intro popup,
// just not yet TRAVELING. This plants a handful of trees/flowers using
// the exact same travel-curve math as the real spawners above (so they
// land exactly where a real one would sit at that point in its trip,
// same size/perspective) but as plain one-off elements, never pushed
// into activeTrees/activeFlowers - so once the tick loops actually start
// (beginRide()), they never touch these. beginRide() removes every
// .staticScenery element at the same moment the real spawners take over,
// so there's no seam where two versions of the same tree coexist.

// Evenly spaced trip-progress values for the frozen yellow center-line
// dashes shown before motion starts (intro popup, first tutorial card) -
// same spacing the live spawner produces (DASH_SPAWN_INTERVAL_MS apart
// over DASH_TRAVEL_MS), so the road looks the same frozen or moving.
const STATIC_DASH_COUNT = Math.floor(DASH_TRAVEL_MS / DASH_SPAWN_INTERVAL_MS);

function placeStaticDashes() {

    if (!roadStripeLayer) {
        return;
    }

    for (let i = 0; i < STATIC_DASH_COUNT; i++) {
        const progress = (i + 0.5) / STATIC_DASH_COUNT;
        const place = dashPlacementAtAge(progress * DASH_TRAVEL_MS);
        const el = document.createElement("div");
        el.className = "ambientDash staticScenery";
        el.dataset.progress = progress;
        el.style.top = place.y + "%";
        el.style.width = place.width + "%";
        el.style.height = place.height + "%";
        roadStripeLayer.appendChild(el);
    }
}

function placeStaticScenery() {

    placeStaticGroundTiles();
    placeStaticDashes();

    if (!ambientLayer) {
        return;
    }

    prefillAmbientScenery();
}

// 2026-09-23 (per Kayla: "when you first start, there should already be
// some trees and stuff around you"): plants trees and flowers at every
// point along the road exactly where the live spawners would have put
// them if they'd already been running - same spacing, alternating sides,
// real entries in activeTrees/activeFlowers with a back-dated age - so
// the road looks full from the first frame (frozen behind the intro
// popup) and they simply keep rolling once motion starts. The spawners'
// own first spawn (age 0, at the hill line) continues the pattern.
function prefillAmbientScenery() {

    const tripMs = sceneAgeAtY(SCENE_NEAR_Y);

    for (let k = 1; k * TREE_SPAWN_INTERVAL_MS < tripMs; k++) {
        // k = 1 is the spawn just before the next live one, so it's on the
        // opposite side from treeSpawnNextIsLeft, and so on alternating.
        const isLeft = (k % 2 === 1) ? !treeSpawnNextIsLeft : treeSpawnNextIsLeft;
        spawnAmbientTree(k * TREE_SPAWN_INTERVAL_MS, isLeft);
    }

    for (let k = 1; k * FLOWER_SPAWN_INTERVAL_MS < tripMs; k++) {
        const isLeft = (k % 2 === 1) ? !flowerSpawnNextIsLeft : flowerSpawnNextIsLeft;
        spawnAmbientFlower(k * FLOWER_SPAWN_INTERVAL_MS, isLeft);
    }
}

/* ================= QUESTIONS (item popup) ================= */

// Every item icon is fetched once up front (see preloadItemIcons below) and
// kept in the browser's own image cache, so by the time a real item needs
// one, swapping <img src> to it is effectively instant instead of kicking
// off a fresh fetch/decode.
const ITEM_ICON_CACHE = {};

function preloadItemIcons() {
    NEED_ITEMS.concat(WANT_ITEMS).forEach(function (item) {
        if (item.icon && !ITEM_ICON_CACHE[item.icon]) {
            const img = new Image();
            img.src = item.icon;
            ITEM_ICON_CACHE[item.icon] = img;
        }
    });
}
preloadItemIcons();

// Fills in the item's picture (when it has one) and its name text together.
// Some items don't have artwork yet, so the icon box just collapses away
// rather than showing a broken image.
//
// The picture is kept hidden (visibility, not display, so it doesn't shift
// the layout) from the moment we start swapping it until the NEW image has
// actually finished decoding and is ready to paint. Without this, changing
// itemPopupIcon.src still shows the previous item's picture on screen for a
// frame or two while the browser loads the new one in - visible as the old
// graphic flashing before the right one snaps in. Preloading (above) makes
// that gap tiny in practice, but this guarantees it can never show stale art
// even on a slower load.
function setItemPopupContent(item) {
    if (itemPopupText) {
        itemPopupText.textContent = item.name;
    }
    if (itemPopupIcon) {
        itemPopupIcon.onload = null;
        itemPopupIcon.onerror = null;
        if (item.icon) {
            itemPopupIcon.style.visibility = "hidden";
            itemPopupIcon.style.display = "";
            itemPopupIcon.alt = item.name;

            const reveal = function () {
                itemPopupIcon.style.visibility = "";
            };

            itemPopupIcon.src = item.icon;

            if (itemPopupIcon.complete && itemPopupIcon.naturalWidth > 0) {
                // Already decoded (the normal case, thanks to preloading) -
                // reveal next frame rather than instantly, so the picture
                // pops in together with the pop-in animation instead of
                // appearing a beat before it.
                requestAnimationFrame(reveal);
            } else {
                itemPopupIcon.onload = reveal;
                itemPopupIcon.onerror = reveal;
            }
        } else {
            itemPopupIcon.removeAttribute("src");
            itemPopupIcon.style.display = "none";
            itemPopupIcon.style.visibility = "";
        }
    }
}

function clearItemPopupContent() {
    if (itemPopupText) {
        itemPopupText.textContent = "";
    }
    if (itemPopupIcon) {
        itemPopupIcon.onload = null;
        itemPopupIcon.onerror = null;
        itemPopupIcon.removeAttribute("src");
        itemPopupIcon.style.display = "none";
        itemPopupIcon.style.visibility = "";
    }
}

function pickNextItem() {

    const pool = gameRounds[currentLevelIndex] || [];
    const item = pool[roundItemIndex] || null;

    roundItemIndex++;

    return item;
}

function showNextItem() {

    if (!gameRunning) {
        return;
    }

    if (totalSorted >= MAX_ITEMS_SAFETY) {
        finishGame();
        return;
    }

    currentItem = pickNextItem();

    if (!currentItem) {
        finishGame();
        return;
    }

    if (itemPopup) {
        setItemPopupContent(currentItem);
        itemPopup.classList.remove("pop");
        // Force reflow so the pop animation re-triggers on every new item.
        void itemPopup.offsetWidth;
        itemPopup.classList.add("pop");
    }

    showSignsForCurrentItem();
}

// The caught sign fills solid green/red (resolveSignsFeedback/flyAwaySign)
// and the item popup rings to match: "correct" = green, "wrong" or "miss"
// = red (a miss has no caught sign, so the popup ring is its only cue).
const ITEM_POPUP_FEEDBACK_CLASSES = ["itemPopup--correct", "itemPopup--wrong", "itemPopup--miss"];
let itemPopupFeedbackTimer = null;

function flashItemPopup(kind) {

    if (!itemPopup) {
        return;
    }

    // "pop" (added whenever the item text last changed) has higher CSS
    // specificity than the feedback classes (.itemPopup.pop vs.
    // .itemPopup--x), so if it's left on, it silently wins the cascade
    // and blocks the color animation entirely. Clear it here too.
    itemPopup.classList.remove("pop", ...ITEM_POPUP_FEEDBACK_CLASSES);
    void itemPopup.offsetWidth;
    itemPopup.classList.add("itemPopup--" + kind);

    clearTimeout(itemPopupFeedbackTimer);
    itemPopupFeedbackTimer = setTimeout(function () {
        itemPopup.classList.remove(...ITEM_POPUP_FEEDBACK_CLASSES);
    }, 900);
}

function flashItemPopupMiss() {
    flashItemPopup("miss");
}

function resolveItem() {

    if (!currentItem || !gameRunning) {
        return;
    }

    const chosenLane = getScooterChoice();

    // The tutorial's one practice catch reuses this same function up to
    // here (so dragging/catching feels identical), but branches off before
    // any score or round-progress bookkeeping - see resolveTutorialDemoItem.
    if (isTutorialDemo) {
        resolveTutorialDemoItem(chosenLane);
        return;
    }

    totalSorted++;

    if (chosenLane === null) {

        // Parked near the middle - a legitimate "I don't know" rather than
        // a guess. No star, no correct/wrong tally, just a gentle nudge
        // showing what it was so they can try to beat it to a lane next time.
        missCount++;

        resolveSignsFeedback(chosenLane);
        flashItemPopupMiss();

    } else if (currentItem.category === chosenLane) {

        correctCount++;
        stars++;

        spawnCorrectStars();
        resolveSignsFeedback(chosenLane, "correct");
        flashItemPopup("correct");

    } else {

        wrongCount++;

        resolveSignsFeedback(chosenLane, "wrong");
        flashItemPopup("wrong");
    }

    // (A correct catch's new dollar amount shows when its stars land -
    // see spawnCorrectStars - not here.)

    currentItem = null;
    roadSignAnimFrame = null;

    checkRideEnd();

    if (gameRunning) {
        nextItemTimer = setTimeout(showNextItem, GAP_BEFORE_NEXT_MS);
    }
}

// Same catch feedback as a real item (sparkle + item-popup glow), but no
// star/correct/wrong/miss tally and no round progress - this is just a
// practice swing. Once the feedback's had a moment to land, it hands off
// straight to the real game (startRealGame), same as clicking Start would.
function resolveTutorialDemoItem(chosenLane) {

    if (chosenLane === null) {

        resolveSignsFeedback(chosenLane);
        flashItemPopupMiss();

    } else if (currentItem.category === chosenLane) {

        spawnCorrectStars();
        resolveSignsFeedback(chosenLane, "correct");
        flashItemPopup("correct");

    } else {

        resolveSignsFeedback(chosenLane, "wrong");
        flashItemPopup("wrong");
    }

    currentItem = null;
    roadSignAnimFrame = null;
    gameRunning = false;
    isTutorialDemo = false;

    nextItemTimer = setTimeout(startRealGame, GAP_BEFORE_NEXT_MS + 400);
}

// How long a single star's flight takes, and the max random stagger added
// per star before it launches, so the group doesn't travel as one rigid
// clump.
// 2026-09-24: bigger, more dramatic burst - more stars, wider scatter,
// taller arcs, a spin, and a bigger launch pop.
const STAR_FLIGHT_MS = 900;
const STAR_STAGGER_MAX_MS = 180;
const STAR_ARC_LIFT_MIN = 90;
const STAR_ARC_LIFT_MAX = 170;
const STAR_COUNT = 12;
const STAR_SCATTER_PX = 40;
// The moment the (staggered-earliest) stars visually reach the card -
// they fade/shrink over the last ~20% of the flight - so the card pops
// and the dollar amount ticks up right as they hit.
const STAR_LAND_MS = Math.round(STAR_FLIGHT_MS * 0.88);

// An element's center, in pixels relative to referenceEl's own top-left
// corner - lets two elements that live in completely different parts of
// the DOM (the scooter, nested deep in #roadScene; the dollars card, a
// sibling of it) still be positioned against one shared, simple
// coordinate space (referenceEl's own box).
// How much an element is currently scaled on screen. #game is a fixed
// 1920x1080 stage shrunk to fit the window with transform: scale(), so
// getBoundingClientRect() returns on-screen (scaled) pixels while
// style.left/top inside #game are in unscaled stage pixels. Dividing by
// this converts one into the other (2026-09-23 fix: without it, the
// tutorial spotlight and the star flight landed up-and-left of their
// targets on any window narrower than 1920px).
function screenScaleOf(el) {
    const rect = el.getBoundingClientRect();
    return (el.offsetWidth && rect.width) ? rect.width / el.offsetWidth : 1;
}

function centerRelativeTo(el, referenceEl) {

    const rect = el.getBoundingClientRect();
    const refRect = referenceEl.getBoundingClientRect();
    const s = screenScaleOf(referenceEl);

    return {
        x: (rect.left + rect.width / 2 - refRect.left) / s,
        y: (rect.top + rect.height / 2 - refRect.top) / s
    };
}

function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// Piecewise but driven straight off raw (un-eased) progress each frame,
// not off keyframe percentages - a little pop on launch, settle down to a
// steady size mid-flight, shrink away as it lands.
function starScaleAt(p) {
    if (p < 0.18) {
        return lerp(0.4, 1.6, p / 0.18);
    }
    if (p < 0.55) {
        return lerp(1.6, 1.0, (p - 0.18) / 0.37);
    }
    return lerp(1.0, 0.45, (p - 0.55) / 0.45);
}

function starOpacityAt(p) {
    if (p < 0.12) {
        return p / 0.12;
    }
    if (p > 0.8) {
        return Math.max(0, 1 - (p - 0.8) / 0.2);
    }
    return 1;
}

// Drives one star's whole flight from a single continuous eased progress
// value along a quadratic bezier (start -> arc control point -> end).
// Deliberately NOT built from CSS @keyframes: a percentage-of-the-way
// keyframe re-applies the timing function fresh for the NEXT segment, so
// the animation decelerated hard approaching that keyframe and then had
// to re-accelerate from a near-standstill into the next one - which read
// as the star pausing and slipping backward before continuing. A single
// unbroken curve, updated every frame like the road signs/ambient scenery
// elsewhere in this file, has no segment boundary for that hitch to
// happen at.
function launchStar(startX, startY, controlX, controlY, endX, endY) {

    if (!starFlightLayer) {
        return;
    }

    const star = document.createElement("span");
    star.className = "flyStar";
    star.innerHTML = randomStarSVG();
    star.style.opacity = "0";

    // Each star spins a random amount (either direction) over its flight.
    const spin = (Math.random() < 0.5 ? -1 : 1) * (180 + Math.random() * 360);

    starFlightLayer.appendChild(star);

    const startTime = performance.now();

    function step(timestamp) {

        const rawProgress = Math.min(1, (timestamp - startTime) / STAR_FLIGHT_MS);
        const eased = easeInOutCubic(rawProgress);
        const remaining = 1 - eased;

        // Quadratic bezier: the control point sits directly above the
        // straight-line midpoint, so horizontally this collapses to a
        // perfectly linear left/right path (no possibility of an X
        // reversal), while vertically it bows the path into one clean arc.
        const x = remaining * remaining * startX + 2 * remaining * eased * controlX + eased * eased * endX;
        const y = remaining * remaining * startY + 2 * remaining * eased * controlY + eased * eased * endY;

        star.style.left = x + "px";
        star.style.top = y + "px";
        star.style.opacity = starOpacityAt(rawProgress).toFixed(2);
        star.style.transform = `translate(-50%, -50%) scale(${starScaleAt(rawProgress).toFixed(3)}) rotate(${(spin * eased).toFixed(1)}deg)`;

        if (rawProgress < 1) {
            requestAnimationFrame(step);
        } else if (star.parentNode) {
            star.parentNode.removeChild(star);
        }
    }

    requestAnimationFrame(step);
}

// A little burst of colorful stars leaves the scooter and arcs up into
// the dollars card - same star graphics/recoloring technique as the
// Coin Catch/Lemonade Stand games' catch bursts, just traveling to a
// destination instead of radiating in place and fading on the spot.
function spawnCorrectStars() {

    if (!starFlightLayer || !scooter || !starsBox) {
        return;
    }

    const origin = centerRelativeTo(scooter, starFlightLayer);
    const destination = centerRelativeTo(starsBox, starFlightLayer);

    for (let i = 0; i < STAR_COUNT; i++) {

        // A little scatter around the scooter at launch, like a small
        // burst, before the group arcs up and over to the card.
        const startX = origin.x + (Math.random() * 2 - 1) * STAR_SCATTER_PX;
        const startY = origin.y + (Math.random() * 2 - 1) * STAR_SCATTER_PX;
        const lift = STAR_ARC_LIFT_MIN + Math.random() * (STAR_ARC_LIFT_MAX - STAR_ARC_LIFT_MIN);

        const controlX = (startX + destination.x) / 2;
        const controlY = (startY + destination.y) / 2 - lift;

        const delay = Math.floor(Math.random() * STAR_STAGGER_MAX_MS);

        setTimeout(function () {
            launchStar(startX, startY, controlX, controlY, destination.x, destination.y);
        }, delay);
    }

    // Stars land -> the card pops AND the dollar amount changes at that
    // same instant (resolveItem deliberately skips updateStars() on a
    // correct catch so the number doesn't jump before the stars arrive).
    // updateStars() reads the live `stars` count, so this is always right
    // even if the ride ended/reset in between.
    setTimeout(function () {
        updateStars();

        starsBox.classList.remove("starsBox--pulse");
        void starsBox.offsetWidth;
        starsBox.classList.add("starsBox--pulse");

        setTimeout(function () {
            starsBox.classList.remove("starsBox--pulse");
        }, 600);

    }, STAR_LAND_MS);
}



/* ================= RIDE END ================= */

function checkRideEnd() {

    if (!gameRunning) {
        return;
    }

    if (roundItemIndex >= ITEMS_PER_ROUND) {
        finishGame();
    }
}


/* ================= FINISH ================= */

function finishGame() {

    if (!gameRunning) {
        return;
    }

    gameRunning = false;
    stopItemLoop();

    const reachedGoal = roundItemIndex >= ITEMS_PER_ROUND;
    const isLastLevel = currentLevelIndex === ROUND_COUNT - 1;

    if (reachedGoal) {
        levelResults[currentLevelIndex] = true;
    }

    let outcome;

    if (!reachedGoal) {
        outcome = "retry";
    } else if (isLastLevel) {
        outcome = "complete";
    } else {
        outcome = "advance";
    }

    finishOutcome = outcome;

    const roundLabel = document.getElementById("roundLabel");

    if (roundLabel) {
        roundLabel.textContent =
            `Round ${currentLevelIndex + 1} of ${ROUND_COUNT}`;
    }

    const finishTitleText = document.getElementById("finishTitleText");

    if (finishTitleText) {
        finishTitleText.textContent =
            outcome === "retry" ? "So Close!" : "Great Job!";
    }

    const finishSummary = document.getElementById("finishSummary");

    // Needs-vs-wants sorting recap - two side-by-side stat tiles (big
    // number, small label underneath): how many sorted right, and how
    // many didn't (mixed up + missed combined into one "missed" count).
    const statCorrectNumber = document.getElementById("statCorrectNumber");
    const statMissedNumber = document.getElementById("statMissedNumber");

    if (statCorrectNumber) {
        statCorrectNumber.textContent = correctCount;
    }

    if (statMissedNumber) {
        statMissedNumber.textContent = wrongCount + missCount;
    }

    if (finishSummary) {
        finishSummary.style.display = "block";
        finishSummary.textContent =
            outcome === "complete"
                ? `You completed all ${ROUND_COUNT} rounds!`
                : "";
    }

    const playAgainLabel = document.getElementById("playAgainLabel");

    if (playAgainLabel) {
        playAgainLabel.textContent =
            outcome === "retry" ? "Try Again" :
            outcome === "complete" ? "Play Again" :
            "Start";
    }

    if (document.activeElement && document.activeElement.blur) {
        document.activeElement.blur();
    }

    if (finishScreen) {
        finishScreen.style.display = "flex";
    }

    const finishCardEl = document.querySelector(".finishCard");

    // Falling confetti only on the final-round popup (2026-09-23).
    if (outcome === "complete") {
        startPopupConfetti(finishCardEl);
    } else {
        stopPopupConfetti(finishCardEl);
    }

    if (finishCardEl) {
        finishCardEl.scrollTop = 0;
    }
}


/* ================= PLAY AGAIN / TRY AGAIN / NEXT ROUND ================= */

function retryRound() {
    beginRide();
}

const playAgainButton = document.getElementById("playAgainButton");

if (playAgainButton) {

    playAgainButton.addEventListener("click", function () {

        if (finishOutcome === "retry") {
            retryRound();
        } else if (finishOutcome === "complete") {
            resetGame();
        } else {
            startNextRound();
        }
    });
}


/* ================= QUESTION LOOP CONTROL ================= */

function stopItemLoop() {

    if (roadSignAnimFrame !== null) {
        cancelAnimationFrame(roadSignAnimFrame);
        roadSignAnimFrame = null;
    }

    if (nextItemTimer !== null) {
        clearTimeout(nextItemTimer);
        nextItemTimer = null;
    }

    roadSignStartTime = null;
    currentItem = null;

    hideSigns();
}

function clearFeedback() {

    if (feedbackLayer) {
        feedbackLayer.innerHTML = "";
    }
}


/* ================= RESET ================= */

/* ================= START / PAUSE / RESUME AMBIENT MOTION (2026-09-23, per Kayla) =================
   The moving background (ground, trees, flowers, landmarks, yellow road
   dashes, sun/cloud CSS animations) now also runs during the tutorial,
   but freezes while a tutorial popup card is up and picks up exactly
   where it left off once the player is acting again:
   - Next on the first card -> starts/resumes (signs roll forward)
   - second card appears -> pauses
   - "Try It!" -> resumes (practice catch), then the real game carries on.
   Pausing keeps every rAF loop alive but skips its update, blocks new
   spawns, and shifts each loop's clock by the total paused time
   (ambientPausedTotalMs) so nothing jumps on resume. */
let ambientPaused = false;
let ambientPauseStartedAt = null;
let ambientPausedTotalMs = 0;

// Swap the frozen pre-game scenery for the live spawners (each start*
// function no-ops if its system is already running).
function startAmbientMotion() {

    // The frozen yellow dashes just start moving from where they sit
    // (handed to the live dash loop with a back-dated start time matching
    // their spot on the road) instead of being removed, so the center line
    // never goes briefly bare near the scooter when motion begins.
    const handoffNow = performance.now() - ambientPausedTotalMs;
    document.querySelectorAll("#roadStripeLayer .ambientDash.staticScenery").forEach(function (el) {
        const progress = parseFloat(el.dataset.progress);
        el.classList.remove("staticScenery");
        if (isNaN(progress)) {
            el.remove();
            return;
        }
        activeDashes.push({ el, startTime: handoffNow - progress * DASH_TRAVEL_MS });
    });

    document.querySelectorAll(".staticScenery").forEach(function (el) {
        el.remove();
    });

    startGroundScrollAmbience();
    startTreeAmbience();
    startFlowerAmbience();
    startLandmarkAmbience();
    startRoadStripeAmbience();

    if (game) {
        game.classList.add("riding");
    }
}

function pauseAmbientMotion() {

    if (ambientPaused) {
        return;
    }

    ambientPaused = true;
    ambientPauseStartedAt = performance.now();

    if (game) {
        game.classList.remove("riding");
    }
}

function resumeAmbientMotion() {

    if (!ambientPaused) {
        return;
    }

    ambientPausedTotalMs += performance.now() - ambientPauseStartedAt;
    ambientPaused = false;
    ambientPauseStartedAt = null;

    if (game) {
        game.classList.add("riding");
    }
}

/* ================= STOP AMBIENT MOTION (2026-09-23, per Kayla) =================
   Restart brings back the intro popup, and the background should be
   still behind it again - exactly like a fresh page load - until Start is
   pressed. Stops all five ambient systems (ground scroll, trees, flowers,
   landmarks, road-center dashes), removes everything they had in flight,
   re-lays the same frozen pre-game scenery the page shows on load
   (placeStaticScenery), and takes the "riding" class back off #game so
   the sun pulse / cloud drift CSS animations pause again. beginRide()
   restarts all of it on Start, since each start*Ambience() guard is
   cleared here. */
function stopAmbientMotion() {

    [treeSpawnTimer, flowerSpawnTimer, landmarkSpawnTimer, dashSpawnTimer]
        .forEach(function (t) { if (t) { clearInterval(t); } });
    treeSpawnTimer = null;
    flowerSpawnTimer = null;
    landmarkSpawnTimer = null;
    dashSpawnTimer = null;

    [treeAnimFrame, flowerAnimFrame, landmarkAnimFrame, dashAnimFrame, groundScrollAnimFrame]
        .forEach(function (f) { if (f) { cancelAnimationFrame(f); } });
    treeAnimFrame = null;
    flowerAnimFrame = null;
    landmarkAnimFrame = null;
    dashAnimFrame = null;
    groundScrollAnimFrame = null;
    groundScrollStartTime = null;

    ambientPaused = false;
    ambientPauseStartedAt = null;
    ambientPausedTotalMs = 0;

    [activeTrees, activeFlowers, activeLandmarks, activeDashes].forEach(function (list) {
        list.forEach(function (item) { if (item.el) { item.el.remove(); } });
    });
    activeTrees = [];
    activeFlowers = [];
    activeLandmarks = [];
    activeDashes = [];

    // Rebuild the ground tiles and the static trees/flowers from scratch,
    // same as page load (placeStaticGroundTiles only lays tiles out when
    // the pool is empty).
    groundTilePool.forEach(function (tile) { tile.remove(); });
    groundTilePool = [];
    document.querySelectorAll(".staticScenery").forEach(function (el) {
        el.remove();
    });
    placeStaticScenery();

    if (game) {
        game.classList.remove("riding");
    }
}

function resetGame() {

    stopAmbientMotion();

    gameRunning = false;
    isTutorialDemo = false;
    stopTutorialTravel();
    hideSpotlight();
    stopItemLoop();
    clearFeedback();

    if (tutorialScreen) {
        tutorialScreen.style.display = "none";
    }

    stars = 0;
    correctCount = 0;
    wrongCount = 0;
    missCount = 0;
    totalSorted = 0;

    currentLevelIndex = 0;
    levelResults = [];
    roundItemIndex = 0;

    setScooterX(50);
    updateStars();

    if (itemPopup) {
        clearItemPopupContent();
        itemPopup.classList.remove("pop", ...ITEM_POPUP_FEEDBACK_CLASSES);
    }

    if (finishScreen) {
        finishScreen.style.display = "none";
    }

    if (startScreen) {
        startScreen.style.display = "flex";
    }
}


/* ================= START / ADVANCE ROUND ================= */

function beginRide() {

    if (startScreen) {
        startScreen.style.display = "none";
    }

    if (finishScreen) {
        finishScreen.style.display = "none";
    }

    // Ambient road motion (scrolling ground, trees, flowers, center-line
    // dashes) starts here instead of at page load (2026-09-22, per Kayla:
    // "no need for motion during the intro popup") - the first real call
    // is the one that matters (Start button -> startRealGame -> here);
    // beginRide() also runs again at the top of every later round via
    // startNextRound(), but each start*Ambience() function already
    // no-ops on a repeat call (see their own already-running guards), so
    // calling them again here every round is harmless.
    // The static pre-game trees/flowers (placeStaticScenery(), called
    // once at page load) hand off to the real spawners right here - the
    // querySelectorAll is cheap and a no-op on every later round, since
    // nothing with this class exists after the first call removes it.
    resumeAmbientMotion();
    startAmbientMotion();

    stopItemLoop();
    clearFeedback();

    correctCount = 0;
    wrongCount = 0;
    missCount = 0;
    totalSorted = 0;
    roundItemIndex = 0;

    setScooterX(50);
    updateStars();

    if (itemPopup) {
        clearItemPopupContent();
        itemPopup.classList.remove("pop", ...ITEM_POPUP_FEEDBACK_CLASSES);
    }

    gameRunning = true;

    nextItemTimer = setTimeout(showNextItem, 500);
}

function startNextRound() {
    currentLevelIndex++;
    beginRide();
}

function startRealGame() {
    buildGameRounds();
    currentLevelIndex = 0;
    levelResults = [];
    beginRide();
}

if (startButton) {
    startButton.addEventListener("click", startRealGame);
}


/* ================= TUTORIAL =================
   A short, two-step spotlight walkthrough offered from the start screen
   (2026-09-16 spotlight rework):

   Step 1 (right side) - a demo item is already sitting in the item
   popup; the spotlight dims everything except that popup while the text
   explains "road signs will appear with everyday items."

   Clicking Next lets the NEED/WANT signs travel partway down the road on
   their own (runTutorialTravelToPause), then freezes them there.

   Step 2 (left side) - the spotlight moves to the two paused signs while
   the text explains sorting the item and steering into the right lane.

   Clicking "Try It!" resumes that exact same travel from exactly where
   it paused (beginTutorialDemoCatch, via roadSignResumeOffsetMs) and
   makes the scooter interactive, so the player gets one live practice
   catch - reusing the exact same drag/tap/animate/catch code as the real
   game (see isTutorialDemo in resolveItem/resolveTutorialDemoItem) -
   before startRealGame() kicks off round 1 for real.

   "Skip tutorial" jumps straight to startRealGame() from either step. */

// How far down the road (in the same 0-1 "visual" space positionRoadSign
// works in, i.e. after easeInPerspective) the signs travel before
// pausing for step 2. Paused earlier than "halfway" (2026-09-17 pacing
// pass) so there's more room left to travel - and therefore more time to
// think - once step 2 resumes them. Matched to the EASED position, not
// raw elapsed time, since easeInPerspective's t*t curve means "some
// fraction of the travel time" would only look about a quarter as far
// down (the signs start slow and rush at the end). Solving eased(t) =
// t*t = TUTORIAL_PAUSE_EASED_PROGRESS for t gives the raw time-progress
// below, which is what beginTutorialDemoCatch uses to resume at exactly
// the right point in the *real* (round-speed) travel timeline.
const TUTORIAL_PAUSE_EASED_PROGRESS = 0.3;
const TUTORIAL_PAUSE_RAW_PROGRESS = Math.sqrt(TUTORIAL_PAUSE_EASED_PROGRESS);

// The intro travel (step 1's "Next" click -> signs pausing for step 2)
// deliberately runs on its own short, fixed clock instead of the real
// per-round travel time - so there's no lag between clicking Next and
// the signs visibly moving, no matter how slow the current round's real
// pace is. It still eases into the same TUTORIAL_PAUSE_EASED_PROGRESS
// endpoint (see runTutorialTravelToPause), just compressed into this
// window; only the *resume* (beginTutorialDemoCatch) needs to match real
// gameplay pacing, and that's handled separately via tutorialPausedElapsedMs.
const TUTORIAL_INTRO_TRAVEL_MS = 1100;

const TUTORIAL_STEPS = [
    {
        title: "Road Signs",
        body: "Road signs will appear with everyday items.",
        nextLabel: "Next",
        // Sits right beside the highlighted item popup, on its right
        // (2026-09-23, per Kayla) - placed in JS once the spotlight is
        // measured, see placeTutorialCardBesideSpotlight().
        side: "besideRight"
    },
    {
        title: "Need or Want?",
        body: "Decide if that item is a NEED or a WANT, then steer into the right lane.",
        nextLabel: "Try It!",
        side: "left"
    }
];

let tutorialStepIndex = 0;

// Separate rAF handle/clock from roadSignAnimFrame/roadSignStartTime -
// this drives the signs' own unpaused travel *before* gameRunning is
// true (it deliberately doesn't check gameRunning, since nothing should
// be draggable yet at this point), so it can't reuse animateRoadSigns.
let tutorialTravelAnimFrame = null;
let tutorialTravelStartTime = null;
let tutorialPausedElapsedMs = 0;


/* ---------- spotlight ---------- */

// Sizes/positions #tutorialSpotlight (the dim-with-a-cutout div) around
// one target element, in #game's own coordinate space (both are
// absolutely positioned within #game), plus some breathing room.
function positionSpotlight(targetEl, padPx) {

    if (!tutorialSpotlight || !targetEl || !game) {
        return;
    }

    const gameRect = game.getBoundingClientRect();
    const targetRect = targetEl.getBoundingClientRect();
    const s = screenScaleOf(game);

    positionSpotlightRect({
        left: (targetRect.left - gameRect.left) / s,
        top: (targetRect.top - gameRect.top) / s,
        width: targetRect.width / s,
        height: targetRect.height / s
    }, padPx);
}

// Same, but sized to the union of both NEED/WANT signs - wherever they
// currently are (mid-travel, paused or not), so the spotlight covers
// both regardless of which side each landed on this item.
function positionSpotlightOnSigns(padPx) {

    if (!tutorialSpotlight || !roadSignNeed || !roadSignWant || !game) {
        return;
    }

    const gameRect = game.getBoundingClientRect();
    const needRect = roadSignNeed.getBoundingClientRect();
    const wantRect = roadSignWant.getBoundingClientRect();

    const left = Math.min(needRect.left, wantRect.left);
    const top = Math.min(needRect.top, wantRect.top);
    const right = Math.max(needRect.right, wantRect.right);
    const bottom = Math.max(needRect.bottom, wantRect.bottom);

    const s = screenScaleOf(game);

    positionSpotlightRect({
        left: (left - gameRect.left) / s,
        top: (top - gameRect.top) / s,
        width: (right - left) / s,
        height: (bottom - top) / s
    }, padPx);
}

function positionSpotlightRect(rect, padPx) {

    if (!tutorialSpotlight) {
        return;
    }

    const pad = padPx === undefined ? 14 : padPx;

    tutorialSpotlight.style.left = (rect.left - pad) + "px";
    tutorialSpotlight.style.top = (rect.top - pad) + "px";
    tutorialSpotlight.style.width = (rect.width + pad * 2) + "px";
    tutorialSpotlight.style.height = (rect.height + pad * 2) + "px";
    tutorialSpotlight.classList.add("show");

    placeTutorialCardBesideSpotlight();
}

// Gap (stage px) between the spotlight's right edge and the tutorial card
// on steps whose side is "besideRight".
const TUTORIAL_CARD_BESIDE_GAP = 28;

// For "besideRight" steps: puts the tutorial card just to the right of
// the spotlight cutout, vertically centered on it, and only reveals the
// card once it's in place (so it never flashes at the old right-edge
// spot first). Other steps keep their CSS left/right edge placement.
function placeTutorialCardBesideSpotlight() {

    const step = TUTORIAL_STEPS[tutorialStepIndex];

    if (!tutorialCard || !tutorialSpotlight || !step || step.side !== "besideRight") {
        return;
    }

    const spotLeft = parseFloat(tutorialSpotlight.style.left) || 0;
    const spotTop = parseFloat(tutorialSpotlight.style.top) || 0;
    const spotWidth = parseFloat(tutorialSpotlight.style.width) || 0;
    const spotHeight = parseFloat(tutorialSpotlight.style.height) || 0;

    tutorialCard.style.left = (spotLeft + spotWidth + TUTORIAL_CARD_BESIDE_GAP) + "px";
    tutorialCard.style.right = "auto";
    tutorialCard.style.top = (spotTop + spotHeight / 2) + "px";
    tutorialCard.style.visibility = "visible";
}

function hideSpotlight() {

    if (tutorialSpotlight) {
        tutorialSpotlight.classList.remove("show");
    }

    if (tutorialSpotlightSettleTimer !== null) {
        clearTimeout(tutorialSpotlightSettleTimer);
        tutorialSpotlightSettleTimer = null;
    }
}

// The very first positionSpotlight/positionSpotlightOnSigns call for a
// step happens synchronously, before the web font (Inter, loaded async
// via the <link> in index.html) has necessarily finished swapping in -
// if its metrics differ from the fallback font mid-measurement, the
// spotlight can end up sized to stale (usually narrower) text. This
// re-measures once, a beat later, and only if the player's still on the
// same step it was scheduled for (not a stale correction landing after
// they've already moved on).
let tutorialSpotlightSettleTimer = null;

function scheduleSpotlightResettle(stepIndexAtCallTime) {

    if (tutorialSpotlightSettleTimer !== null) {
        clearTimeout(tutorialSpotlightSettleTimer);
    }

    tutorialSpotlightSettleTimer = setTimeout(function () {

        tutorialSpotlightSettleTimer = null;

        const stillOnSameStep =
            tutorialStepIndex === stepIndexAtCallTime &&
            tutorialScreen &&
            tutorialScreen.style.display !== "none";

        if (!stillOnSameStep) {
            return;
        }

        if (stepIndexAtCallTime === 0) {
            positionSpotlight(itemPopup, 16);
        } else {
            positionSpotlightOnSigns(14);
        }
    }, 250);
}


/* ---------- step flow ---------- */

function showTutorialStep(index) {

    tutorialStepIndex = index;

    // Background freezes behind every tutorial popup card.
    pauseAmbientMotion();

    const step = TUTORIAL_STEPS[index];

    if (tutorialTitle) {
        tutorialTitle.textContent = step.title;
    }

    if (tutorialBody) {
        tutorialBody.textContent = step.body;
    }

    if (tutorialNextButton) {
        tutorialNextButton.textContent = step.nextLabel;
    }

    if (tutorialCard) {
        tutorialCard.classList.toggle("tutorialCard--right", step.side === "right");
        tutorialCard.classList.toggle("tutorialCard--left", step.side === "left");

        // Clear any beside-the-spotlight placement from a previous step so
        // the CSS left/right classes above take over again; a
        // "besideRight" step stays hidden until the spotlight is measured
        // and placeTutorialCardBesideSpotlight() moves it into place.
        tutorialCard.style.left = "";
        tutorialCard.style.right = "";
        tutorialCard.style.top = "";
        tutorialCard.style.visibility = step.side === "besideRight" ? "hidden" : "";
    }

    if (tutorialScreen) {
        tutorialScreen.style.display = "block";
    }

    // Step 1 (the paused signs) can be spotlighted immediately - their
    // position/size come from direct inline styles set every frame, not
    // a CSS animation, so there's no "still settling" window to wait
    // out. Step 0 (the item popup) is spotlighted from
    // onDemoItemPopupSettled() instead, once its own pop-in animation
    // has actually finished - spotlighting it here, before that
    // animation even starts, was sizing the spotlight to the popup's
    // small/mid-animation box, then visibly resizing once it settled.
    if (index === 1) {
        positionSpotlightOnSigns(14);
        scheduleSpotlightResettle(1);
    }
}

function startTutorial() {

    if (startScreen) {
        startScreen.style.display = "none";
    }

    // A demo item sits in the popup from the very first tutorial step,
    // same spot/animation as a real item, so there's already something
    // on screen (and something for step 1's spotlight to point at)
    // while the first step's text is explaining it.
    const demoItem = shuffle(NEED_ITEMS.concat(WANT_ITEMS))[0];
    currentItem = demoItem;

    if (itemPopup) {
        setItemPopupContent(demoItem);
        itemPopup.classList.remove("pop");
        void itemPopup.offsetWidth;
        itemPopup.classList.add("pop");
        // The spotlight only goes up once this pop-in animation has
        // actually finished - see onDemoItemPopupSettled - so it's never
        // sized to the popup mid-animation while still small/overshooting.
        itemPopup.addEventListener("animationend", onDemoItemPopupSettled, { once: true });
    }

    showTutorialStep(0);
}

function onDemoItemPopupSettled() {

    // Guards against a leftover listener firing after the player's
    // already skipped/reset past step 0.
    if (tutorialStepIndex !== 0 || !tutorialScreen || tutorialScreen.style.display === "none") {
        return;
    }

    positionSpotlight(itemPopup, 16);
    scheduleSpotlightResettle(0);
}

// Step 1 -> step 2: let the NEED/WANT signs travel on their own (nothing
// draggable yet - gameRunning is still false) until they reach the
// halfway point, then freeze them and bring up step 2's popup right
// beside them.
function advanceToTutorialStep1() {

    // Player pressed Next - the road comes alive while the signs roll in.
    resumeAmbientMotion();
    startAmbientMotion();

    hideSpotlight();

    if (tutorialScreen) {
        tutorialScreen.style.display = "none";
    }

    if (roadSignNeed) {
        roadSignNeed.style.opacity = "1";
    }

    if (roadSignWant) {
        roadSignWant.style.opacity = "1";
    }

    tutorialTravelStartTime = null;
    tutorialTravelAnimFrame = requestAnimationFrame(runTutorialTravelToPause);
}

function runTutorialTravelToPause(timestamp) {

    if (tutorialTravelStartTime === null) {
        tutorialTravelStartTime = timestamp;
    }

    const elapsed = timestamp - tutorialTravelStartTime;
    const u = Math.min(1, elapsed / TUTORIAL_INTRO_TRAVEL_MS);

    // positionRoadSign applies easeInPerspective (t*t) to whatever raw
    // progress it's given. Feeding it (u * TUTORIAL_PAUSE_RAW_PROGRESS)
    // means the *result* eases from 0 up to exactly
    // TUTORIAL_PAUSE_EASED_PROGRESS as u goes 0 -> 1 - same eased "slow
    // start, rush at the end" shape as the real travel, just compressed
    // into this short fixed window instead of a full round's real pace.
    const introProgress = u * TUTORIAL_PAUSE_RAW_PROGRESS;

    positionRoadSign(roadSignNeed, introProgress, needIsOnLeftThisItem);
    positionRoadSign(roadSignWant, introProgress, !needIsOnLeftThisItem);

    if (u >= 1) {
        // The *real* elapsed-time equivalent of this pause point, in the
        // real per-round travel timeline - not this intro's own fast
        // clock - so beginTutorialDemoCatch resumes at real gameplay
        // pace, not the intro's sped-up one.
        tutorialPausedElapsedMs = TUTORIAL_PAUSE_RAW_PROGRESS * currentSignTravelMs();
        tutorialTravelAnimFrame = null;
        showTutorialStep(1);
        return;
    }

    tutorialTravelAnimFrame = requestAnimationFrame(runTutorialTravelToPause);
}

function stopTutorialTravel() {

    if (tutorialTravelAnimFrame !== null) {
        cancelAnimationFrame(tutorialTravelAnimFrame);
        tutorialTravelAnimFrame = null;
    }

    tutorialTravelStartTime = null;
}

// Step 2 -> live practice catch: resume the exact same travel (same
// item, same sides) right where the pause left it, and make the scooter
// interactive. Deliberately does NOT call showSignsForCurrentItem() -
// that re-rolls needIsOnLeftThisItem, which would make the already-
// paused signs jump to the other side instead of continuing smoothly.
function beginTutorialDemoCatch() {

    // "Try It!" - the player is steering now, so the road moves again.
    resumeAmbientMotion();

    hideSpotlight();

    if (tutorialScreen) {
        tutorialScreen.style.display = "none";
    }

    isTutorialDemo = true;
    gameRunning = true;
    setScooterX(50);

    roadSignResumeOffsetMs = tutorialPausedElapsedMs;
    roadSignStartTime = null;
    roadSignAnimFrame = requestAnimationFrame(animateRoadSigns);
}

function skipTutorial() {

    hideSpotlight();

    if (tutorialScreen) {
        tutorialScreen.style.display = "none";
    }

    stopTutorialTravel();
    stopItemLoop();
    isTutorialDemo = false;
    gameRunning = false;
    currentItem = null;

    if (itemPopup) {
        clearItemPopupContent();
        itemPopup.classList.remove("pop", ...ITEM_POPUP_FEEDBACK_CLASSES);
    }

    startRealGame();
}

if (tutorialButton) {
    tutorialButton.addEventListener("click", startTutorial);
}

if (tutorialSkipButton) {
    tutorialSkipButton.addEventListener("click", skipTutorial);
}

if (tutorialNextButton) {
    tutorialNextButton.addEventListener("click", function () {
        if (tutorialStepIndex === 0) {
            advanceToTutorialStep1();
        } else {
            beginTutorialDemoCatch();
        }
    });
}


/* ================= TOP BAR RESET ================= */

const resetButton = document.getElementById("resetButton");

if (resetButton) {
    resetButton.addEventListener("click", function () {
        resetGame();
    });
}


/* ================= INITIAL STATE ================= */

setScooterX(50);
updateStars();

if (finishScreen) {
    finishScreen.style.display = "none";
}

// Ambient road motion (scrolling ground, trees, flowers, center-line
// dashes) - held off until the player actually starts riding (see
// beginRide() below), per Kayla: no motion behind the intro popup.
// AMBIENT BACKGROUND MOTION. A handful of trees/flowers are still placed
// up front so the road doesn't look bare while it's frozen - see
// placeStaticScenery() near AMBIENT BACKGROUND MOTION - just not moving
// yet.
placeStaticScenery();

// Kiosk auto-launch: the home screen can open this page with ?tutorial=1
// appended to its URL. When that's present, this is a fresh arrival from
// the home screen -- skip the Start/Tutorial choice and jump straight
// into the guided walkthrough (startTutorial() hides the start screen
// itself). Without it (a reload, or any other way this page happens to
// load) the normal start screen shows, same as always, and the player
// picks Start or Tutorial themselves. This check only runs once here at
// page load -- resetGame() and the top-bar reset button never touch the
// URL and always bring back the normal start screen, so an in-session
// restart is unaffected either way.
const launchParams = new URLSearchParams(window.location.search);

if (launchParams.get("tutorial") === "1") {
    startTutorial();
} else if (startScreen) {
    startScreen.style.display = "flex";
}


/* ================= POPUP CONFETTI (final popup) =================
   Same falling confetti as Budget Builder's grand finale
   (2026-09-23, per Kayla). Adds a .popup-confetti layer as the
   popup box's first child and fills it with looping pieces; the
   layer sits behind the popup's content (see style.css). Call
   stopPopupConfetti() whenever the same box is shown for a
   non-final result so the confetti doesn't carry over. */

const POPUP_CONFETTI_COLORS = ["#258BFF", "#FFF025", "#ffffff", "#59D2FE", "#8BD1FF"];

function startPopupConfetti(box) {
    if (!box) {
        return;
    }
    let layer = box.querySelector(":scope > .popup-confetti");
    if (!layer) {
        layer = document.createElement("div");
        layer.className = "popup-confetti";
        layer.setAttribute("aria-hidden", "true");
        box.insertBefore(layer, box.firstChild);
    }
    layer.innerHTML = "";
    for (let n = 0; n < 32; n++) {
        const piece = document.createElement("span");
        piece.style.left = `${Math.random() * 100}%`;
        piece.style.background = POPUP_CONFETTI_COLORS[n % POPUP_CONFETTI_COLORS.length];
        piece.style.animationDelay = `${(Math.random() * 4).toFixed(2)}s`;
        piece.style.animationDuration = `${(3.2 + Math.random() * 2.6).toFixed(2)}s`;
        piece.style.setProperty("--spin", `${Math.round(Math.random() * 720 - 360)}deg`);
        piece.style.setProperty("--drift", `${Math.round(Math.random() * 120 - 60)}px`);
        layer.appendChild(piece);
    }
}

function stopPopupConfetti(box) {
    const layer = box && box.querySelector(":scope > .popup-confetti");
    if (layer) {
        layer.innerHTML = "";
    }
}
