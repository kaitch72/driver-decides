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
======================================== */

/* ================= TUNING CONSTANTS ================= */

// How long the NEED/WANT signs take to travel from the horizon down to the
// scooter's row - this IS the decision window now (no separate timer).
const SIGN_TRAVEL_MS = 4800;

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

function signLaneX(y, isNeed) {
    const half = roadHalfWidthAt(y);
    return isNeed ? 50 - SIGN_LANE_FRACTION * half : 50 + SIGN_LANE_FRACTION * half;
}

// Where each sign ends up once it reaches the scooter's row - used both to
// draw the final frame and to know how close the scooter has to be parked
// to actually "catch" it.
const SIGN_X_COLLISION_NEED = signLaneX(SIGN_COLLISION_Y, true);
const SIGN_X_COLLISION_WANT = signLaneX(SIGN_COLLISION_Y, false);

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

let roadSignAnimFrame = null;  // rAF handle for the current NEED/WANT travel
let roadSignStartTime = null;


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

const finishScreen = document.getElementById("finishScreen");


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
    if (Math.abs(scooterX - SIGN_X_COLLISION_NEED) <= CATCH_ZONE_HALF_WIDTH) {
        return "need";
    }
    if (Math.abs(scooterX - SIGN_X_COLLISION_WANT) <= CATCH_ZONE_HALF_WIDTH) {
        return "want";
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

        const targetX = zone.dataset.lane === "need" ? 26 : 74;

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
        roadSignStartTime = timestamp;
    }

    const elapsed = timestamp - roadSignStartTime;
    const progress = Math.min(1, elapsed / SIGN_TRAVEL_MS);

    positionRoadSign(roadSignNeed, progress, true);
    positionRoadSign(roadSignWant, progress, false);

    if (progress >= 1) {
        resolveItem();
        return;
    }

    roadSignAnimFrame = requestAnimationFrame(animateRoadSigns);
}

function positionRoadSign(el, progress, isNeed) {

    if (!el) {
        return;
    }

    const eased = easeInPerspective(progress);
    const y = lerp(SIGN_HORIZON_Y, SIGN_COLLISION_Y, eased);
    // x is solved from the road's real width at this row (see signLaneX)
    // rather than interpolated between two guessed endpoints, so the sign
    // rides the widening pavement instead of cutting a straight line that
    // can drift off it partway down.
    const x = signLaneX(y, isNeed);
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
    stopItemLoop();
    clearFeedback();

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

if (startButton) {
    startButton.addEventListener("click", function () {
        buildGameRounds();
        currentLevelIndex = 0;
        levelResults = [];
        beginRide();
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

if (startScreen) {
    startScreen.style.display = "flex";
}

if (finishScreen) {
    finishScreen.style.display = "none";
}