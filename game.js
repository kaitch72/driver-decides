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

// The correct/incorrect toast pops up above the scooter's own artwork
// instead of centered on it - centering it on the scooter let its
// handlebars clip the first word or two of the message.
const TOAST_Y = 62;

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
    { name: "School Supplies", category: "need" },
    { name: "Healthy Food", category: "need" },
    { name: "Medicine", category: "need" },
    { name: "Toothbrush", category: "need" },
    { name: "Backpack", category: "need" },
    { name: "Glasses", category: "need" },
    { name: "Soap", category: "need" },
    { name: "Bike Helmet", category: "need" },
    { name: "Dentist Visit", category: "need" },
    { name: "Winter Jacket", category: "need" },
    { name: "Water", category: "need" },
    { name: "Groceries", category: "need" }
];

const WANT_ITEMS = [
    { name: "Candy", category: "want" },
    { name: "Video Games", category: "want" },
    { name: "Fast Food", category: "want" },
    { name: "Trading Cards", category: "want" },
    { name: "Movie Tickets", category: "want" },
    { name: "Soda", category: "want" },
    { name: "Stickers", category: "want" },
    { name: "Comic Book", category: "want" },
    { name: "Ice Cream", category: "want" },
    { name: "Fidget Toy", category: "want" },
    { name: "Theme Park Ticket", category: "want" },
    { name: "New Phone Case", category: "want" }
];

// Same tone-cycling sparkle burst used for catches in Coin Catch and
// Lemonade Stand - reused here for every correct sort.
const SPARKLE_SVG = `
    <svg viewBox="0 0 179.8 170" aria-hidden="true">
        <polygon points="159.82 49.96 149.85 50 149.86 30 129.88 30 129.88 19.99 149.86 20 149.85 0 159.82 0 159.82 20 179.79 19.99 179.8 30 159.82 29.99 159.82 49.96"/>
        <polygon points="149.83 169.96 139.86 170 139.87 150 119.89 150 119.89 139.99 139.87 140 139.86 120 149.83 120 149.82 140 169.8 139.99 169.8 150 149.83 149.99 149.83 169.96"/>
        <path d="M64.87,149.82l-20.03-44.88L0,84.99l44.96-20.07,19.91-44.96,20.01,45.1,44.86,19.96-44.93,20-19.93,44.81ZM64.88,125.25l12.55-27.81,27.77-12.46-27.88-12.52-12.45-27.71-12.55,27.76-27.72,12.49,27.75,12.48,12.53,27.76Z"/>
    </svg>
`;

const SPARKLE_TONES = ["#1943DC", "#258BFF", "#59D2FE"]; // Persian Blue / Blue Bird / Malibu


/* ================= ELEMENTS ================= */

const game = document.getElementById("game");
const scooter = document.getElementById("scooter");
const roadScene = document.getElementById("roadScene");
const feedbackLayer = document.getElementById("feedbackLayer");
const itemPopup = document.getElementById("itemPopup");
const roadSignNeed = document.getElementById("roadSignNeed");
const roadSignWant = document.getElementById("roadSignWant");

const starsValueDisplay = document.getElementById("starsValue");

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


/* ================= QUESTIONS (item popup) ================= */

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
        itemPopup.textContent = currentItem.name;
        itemPopup.classList.remove("pop");
        // Force reflow so the pop animation re-triggers on every new item.
        void itemPopup.offsetWidth;
        itemPopup.classList.add("pop");
    }

    showSignsForCurrentItem();
}

function flashItemPopup(kind) {

    if (!itemPopup) {
        return;
    }

    const className = kind === "correct"
        ? "itemPopup--correct"
        : kind === "miss"
            ? "itemPopup--miss"
            : "itemPopup--wrong";
    itemPopup.classList.remove("itemPopup--correct", "itemPopup--wrong", "itemPopup--miss");
    void itemPopup.offsetWidth;
    itemPopup.classList.add(className);

    setTimeout(function () {
        itemPopup.classList.remove(className);
    }, 500);
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

    // The signs have arrived - hide them right away, they've been "caught"
    // (or missed, if the scooter never committed to a lane).
    hideSigns();

    if (chosenLane === null) {

        // Parked near the middle - a legitimate "I don't know" rather than
        // a guess. No star, no correct/wrong tally, just a gentle nudge
        // showing what it was so they can try to beat it to a lane next time.
        missCount++;

        spawnToast(
            `That one got away - it was a ${currentItem.category}!`,
            "toast--miss"
        );
        flashItemPopup("miss");

    } else if (currentItem.category === chosenLane) {

        correctCount++;
        stars++;

        spawnSparkles();
        spawnToast(
            `Yes! That's a ${currentItem.category}!`,
            "toast--correct"
        );
        flashItemPopup("correct");

    } else {

        wrongCount++;

        spawnToast(
            `Actually, that's a ${currentItem.category}!`,
            "toast--wrong"
        );
        flashItemPopup("wrong");
    }

    updateStars();

    currentItem = null;
    roadSignAnimFrame = null;

    checkRideEnd();

    if (gameRunning) {
        nextItemTimer = setTimeout(showNextItem, GAP_BEFORE_NEXT_MS);
    }
}

// Same catch feedback as a real item (toast + sparkle + item-popup flash),
// but no star/correct/wrong/miss tally and no round progress - this is
// just a practice swing. Once the feedback's had a moment to land, it
// hands off straight to the real game (startRealGame), same as clicking
// Start would.
function resolveTutorialDemoItem(chosenLane) {

    hideSigns();

    if (chosenLane === null) {

        spawnToast(
            `That one got away - it was a ${currentItem.category}!`,
            "toast--miss"
        );
        flashItemPopup("miss");

    } else if (currentItem.category === chosenLane) {

        spawnSparkles();
        spawnToast(
            `Yes! That's a ${currentItem.category}!`,
            "toast--correct"
        );
        flashItemPopup("correct");

    } else {

        spawnToast(
            `Actually, that's a ${currentItem.category}!`,
            "toast--wrong"
        );
        flashItemPopup("wrong");
    }

    currentItem = null;
    roadSignAnimFrame = null;
    gameRunning = false;
    isTutorialDemo = false;

    nextItemTimer = setTimeout(startRealGame, GAP_BEFORE_NEXT_MS + 400);
}

function spawnSparkles() {

    const centerLeft = scooterX;
    const centerTop = SIGN_COLLISION_Y;
    const sparkleCount = 9;

    for (let i = 0; i < sparkleCount; i++) {

        const sparkle = document.createElement("span");
        sparkle.className = "sparkle";
        sparkle.innerHTML = SPARKLE_SVG;

        const svgEl = sparkle.querySelector("svg");
        if (svgEl) {
            svgEl.style.fill =
                SPARKLE_TONES[Math.floor(Math.random() * SPARKLE_TONES.length)];
        }

        const angle = Math.random() * Math.PI * 2;
        const distance = 24 + Math.random() * 34;

        sparkle.style.left = centerLeft + "%";
        sparkle.style.top = centerTop + "%";
        sparkle.style.setProperty("--tx", (Math.cos(angle) * distance).toFixed(1) + "px");
        sparkle.style.setProperty("--ty", (Math.sin(angle) * distance).toFixed(1) + "px");
        sparkle.style.animationDelay = Math.floor(Math.random() * 90) + "ms";

        if (feedbackLayer) {
            feedbackLayer.appendChild(sparkle);
        }

        setTimeout(function () {
            if (sparkle.parentNode) {
                sparkle.parentNode.removeChild(sparkle);
            }
        }, 850);
    }
}

function spawnToast(text, className) {

    const toast = document.createElement("div");
    toast.className = "catchToast " + className;
    toast.textContent = text;
    toast.style.top = TOAST_Y + "%";
    toast.style.left = scooterX + "%";

    if (feedbackLayer) {
        feedbackLayer.appendChild(toast);
    }

    setTimeout(function () {
        if (toast.parentNode) {
            toast.parentNode.removeChild(toast);
        }
    }, 1100);
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

function resetGame() {

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
        itemPopup.textContent = "";
        itemPopup.classList.remove("pop", "itemPopup--correct", "itemPopup--wrong", "itemPopup--miss");
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
        itemPopup.textContent = "";
        itemPopup.classList.remove("pop", "itemPopup--correct", "itemPopup--wrong", "itemPopup--miss");
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
        side: "right"
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

    positionSpotlightRect({
        left: targetRect.left - gameRect.left,
        top: targetRect.top - gameRect.top,
        width: targetRect.width,
        height: targetRect.height
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

    positionSpotlightRect({
        left: left - gameRect.left,
        top: top - gameRect.top,
        width: right - left,
        height: bottom - top
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
        itemPopup.textContent = demoItem.name;
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
        itemPopup.textContent = "";
        itemPopup.classList.remove("pop", "itemPopup--correct", "itemPopup--wrong", "itemPopup--miss");
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