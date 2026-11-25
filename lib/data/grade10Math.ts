import {
  encryptQuizPack,
  syncSaltedHash,
  type EncryptedQuizPack,
  type QuizPackPlainPayload,
  type VaultQuestion,
} from "../crypto/quizVault";

export interface StudyExample {
  label: string;
  steps: string;
}

export interface StudyPracticeItem {
  id: string;
  prompt: string;
  expectedHash: string;
  solutionSteps: string[];
}

export interface StudyMcqItem {
  id: string;
  prompt: string;
  options: string[];
  correctHash: string;
  salt: string;
  explanation: string;
}

export interface MathTopicModule {
  id: string;
  weekNumber: number;
  topicCode: string;
  title: string;
  competency: string;
  principles: string[];
  steps: string[];
  examples: StudyExample[];
  caution: string;
  application: string;
  matchingPairs: { id: string; left: string; right: string }[];
  practiceItems: StudyPracticeItem[];
  scenarioContext: string;
  scenarioQuestions: StudyMcqItem[];
  reflectionPrompt: string;
}

export interface QuizBlueprintItem {
  id: string;
  topicCode: string;
  prompt: string;
  options: string[];
  correctIndex: number;
  points: number;
  explanation?: string;
}

export interface QuizBlueprint {
  id: string;
  title: string;
  subject: string;
  description: string;
  durationMinutes: number;
  instantFeedback: boolean;
  allowRetry: boolean;
  items: QuizBlueprintItem[];
}

export const GRADE10_TOPIC_LABELS: Record<string, string> = {
  A: "Rational Exponents & Radicals",
  B: "Operations on Radicals",
  C: "Discriminant & Root Nature",
  D: "Quadratic Functions & Equations",
  E: "Quadratic Optimization",
  F: "Radical Equations",
  G: "Coordinate Geometry of Circles",
};

export const GRADE10_MODULES: MathTopicModule[] = [
  {
    id: "w1-radicals",
    weekNumber: 1,
    topicCode: "A",
    title: "Rational Exponents & Radicals",
    competency:
      "Illustrate the laws of rational non-integral exponents and simplify radical expressions into simplest form.",
    principles: [
      "For real a and integers m, n (n > 1): a^(1/n) = root[n](a) and a^(m/n) = (root[n](a))^m = root[n](a^m). Even n requires a >= 0.",
      "Exponent laws: a^m * a^n = a^(m+n), a^m / a^n = a^(m-n), (a^m)^n = a^(mn), a^(-n) = 1 / a^n, a^0 = 1 (a != 0).",
      "Simplest radical form: no perfect nth-power factors remain inside the radicand, no fractions sit under the radical, and no radical remains in a denominator.",
    ],
    steps: [
      "Factor out the largest perfect nth power from the radicand (e.g., perfect squares for sqrt, cubes for root[3]).",
      "Extract the principal nth root to place outside the radical sign.",
      "Divide each variable exponent by the index n; keep remainders inside.",
    ],
    examples: [
      { label: "Square root reduction", steps: "sqrt(72) = sqrt(36 * 2) = 6sqrt(2)" },
      { label: "Fractional exponent", steps: "27^(2/3) = (root[3](27))^2 = 3^2 = 9" },
      { label: "Variable radicand", steps: "sqrt(144x^4y^6) = 12x^2y^3" },
      { label: "Cube root reduction", steps: "root[3](54) = root[3](27 * 2) = 3root[3](2)" },
    ],
    caution:
      "Radicals never distribute over addition or subtraction: sqrt(a + b) != sqrt(a) + sqrt(b). Multiply exponents only when raising a power to another power.",
    application:
      "Since square plot area is A = s^2, a coffee plot in Valencia City measuring 144x^4y^6 m^2 has side length s = sqrt(144x^4y^6) = 12x^2y^3 m.",
    matchingPairs: [
      { id: "w1-p1", left: "sqrt(49a^6b^4)", right: "7a^3b^2" },
      { id: "w1-p2", left: "(81m^8n^12)^(1/4)", right: "3m^2n^3" },
      { id: "w1-p3", left: "root[3](27x^9y^3)", right: "3x^3y" },
      { id: "w1-p4", left: "8^(2/3)", right: "4" },
    ],
    practiceItems: [
      {
        id: "w1-s1",
        prompt: "Evaluate 27^(2/3).",
        expectedHash: syncSaltedHash(9, "w1-s1"),
        solutionSteps: [
          "Take the cube root first: root[3](27) = 3.",
          "Square the result: 3^2 = 9.",
        ],
      },
      {
        id: "w1-s2",
        prompt: "Evaluate 16^(3/4).",
        expectedHash: syncSaltedHash(8, "w1-s2"),
        solutionSteps: [
          "Find the 4th root: root[4](16) = 2 (since 2^4 = 16).",
          "Cube the result: 2^3 = 8.",
        ],
      },
    ],
    scenarioContext:
      "A coffee farm plot in Barangay Lilingayon has area 144x^4y^6 m^2, and a square public market stall occupies 50 m^2.",
    scenarioQuestions: [
      {
        id: "w1-q1",
        prompt: "Find the side length of the square coffee parcel.",
        options: ["72x^2y^3 m", "12x^2y^3 m", "12x^4y^6 m", "12xy m"],
        correctHash: syncSaltedHash(1, "w1-q1-salt"),
        salt: "w1-q1-salt",
        explanation: "Take sqrt(144x^4y^6): sqrt(144) = 12 and exponents divide by 2, giving 12x^2y^3 m.",
      },
      {
        id: "w1-q2",
        prompt: "Calculate the perimeter of the 50 m^2 market stall in simplest radical form.",
        options: ["10sqrt(2) m", "5sqrt(2) m", "20sqrt(2) m", "25sqrt(2) m"],
        correctHash: syncSaltedHash(2, "w1-q2-salt"),
        salt: "w1-q2-salt",
        explanation: "Side s = sqrt(50) = 5sqrt(2) m. Perimeter P = 4 * 5sqrt(2) = 20sqrt(2) m.",
      },
    ],
    reflectionPrompt:
      "Which law of rational exponents needed the most care in your work, and how does area modeling clarify fractional powers?",
  },
  {
    id: "w2-operations-radicals",
    weekNumber: 2,
    topicCode: "B",
    title: "Operations on Radicals",
    competency:
      "Perform addition, subtraction, multiplication, and division of radicals including rationalizing denominators.",
    principles: [
      "Only like radicals (same index and same radicand) can be combined by adding coefficients: a*sqrt(r) + b*sqrt(r) = (a + b)sqrt(r).",
      "For equal indices: sqrt(a) * sqrt(b) = sqrt(ab) and sqrt(a) / sqrt(b) = sqrt(a/b) for b > 0.",
      "To clear a binomial radical denominator (a + sqrt(b)), multiply top and bottom by its conjugate (a - sqrt(b)).",
    ],
    steps: [
      "Simplify each radical term before attempting addition or subtraction.",
      "Combine coefficients of matching radicands.",
      "Multiply fractions by a radical or conjugate form of 1 to rationalize denominators.",
    ],
    examples: [
      { label: "Combining radicals", steps: "sqrt(18) + sqrt(8) = 3sqrt(2) + 2sqrt(2) = 5sqrt(2)" },
      { label: "Multiplying radicals", steps: "(2sqrt(3))(5sqrt(6)) = 10sqrt(18) = 30sqrt(2)" },
      { label: "Monomial denominator", steps: "12 / sqrt(6) = 12sqrt(6) / 6 = 2sqrt(6)" },
      { label: "Conjugate denominator", steps: "1 / (sqrt(5) - 2) = (sqrt(5) + 2) / (5 - 4) = sqrt(5) + 2" },
    ],
    caution:
      "Never add radicands directly: sqrt(2) + sqrt(3) does NOT equal sqrt(5). Always multiply both numerator and denominator when rationalizing.",
    application:
      "Festival pavilion builders rationalize fractional radical lengths so carpenters can measure materials quickly and consistently.",
    matchingPairs: [
      { id: "w2-p1", left: "sqrt(18) + sqrt(8)", right: "5sqrt(2)" },
      { id: "w2-p2", left: "6 / sqrt(3)", right: "2sqrt(3)" },
      { id: "w2-p3", left: "sqrt(3) * sqrt(12)", right: "6" },
      { id: "w2-p4", left: "1 / (sqrt(5) - 2)", right: "sqrt(5) + 2" },
    ],
    practiceItems: [
      {
        id: "w2-s1",
        prompt: "If sqrt(12) + sqrt(27) = a*sqrt(3), what is the value of a?",
        expectedHash: syncSaltedHash(5, "w2-s1"),
        solutionSteps: [
          "Simplify both terms: sqrt(12) = 2sqrt(3) and sqrt(27) = 3sqrt(3).",
          "Add coefficients: 2sqrt(3) + 3sqrt(3) = 5sqrt(3), so a = 5.",
        ],
      },
      {
        id: "w2-s2",
        prompt: "Evaluate the conjugate product (3 + sqrt(2))(3 - sqrt(2)).",
        expectedHash: syncSaltedHash(7, "w2-s2"),
        solutionSteps: [
          "Apply (a + b)(a - b) = a^2 - b^2.",
          "3^2 - (sqrt(2))^2 = 9 - 2 = 7.",
        ],
      },
    ],
    scenarioContext:
      "Pavilion banner lengths measure 3sqrt(2) m and 5sqrt(2) m, while a decorative trim strip measures 12 / sqrt(6) m.",
    scenarioQuestions: [
      {
        id: "w2-q1",
        prompt: "What is the combined length of the two banners?",
        options: ["15sqrt(2) m", "8sqrt(4) m", "2sqrt(2) m", "8sqrt(2) m"],
        correctHash: syncSaltedHash(3, "w2-q1-salt"),
        salt: "w2-q1-salt",
        explanation: "Sum like radicals: (3 + 5)sqrt(2) = 8sqrt(2) m.",
      },
      {
        id: "w2-q2",
        prompt: "Express 12 / sqrt(6) m with a rationalized denominator.",
        options: ["2sqrt(6) m", "12sqrt(6) m", "sqrt(6) m", "6sqrt(2) m"],
        correctHash: syncSaltedHash(0, "w2-q2-salt"),
        salt: "w2-q2-salt",
        explanation: "(12 * sqrt(6)) / (sqrt(6) * sqrt(6)) = 12sqrt(6) / 6 = 2sqrt(6) m.",
      },
    ],
    reflectionPrompt:
      "Explain why simplifying radicals first is necessary before adding them, and where rationalizing denominators helps in real measurement.",
  },
  {
    id: "w3-discriminant",
    weekNumber: 3,
    topicCode: "C",
    title: "Discriminant & Nature of Roots",
    competency:
      "Classify the roots of a quadratic equation using D = b^2 - 4ac without solving fully.",
    principles: [
      "Standard form: ax^2 + bx + c = 0 (a != 0).",
      "D = b^2 - 4ac > 0 and square -> two distinct rational roots; D > 0 non-square -> two distinct irrational roots.",
      "D = 0 -> one repeated real rational root; D < 0 -> no real roots (two complex conjugate roots).",
    ],
    steps: [
      "Move every term to one side so the equation equals zero.",
      "Read a, b, and c with their exact positive/negative signs.",
      "Evaluate D = b^2 - 4ac and match its sign and squareness.",
    ],
    examples: [
      { label: "Two rational roots", steps: "2x^2 - 5x - 3 = 0 -> D = (-5)^2 - 4(2)(-3) = 49" },
      { label: "Two irrational roots", steps: "x^2 - 2x - 2 = 0 -> D = 4 + 8 = 12" },
      { label: "Equal root parameter", steps: "x^2 - 6x + k = 0 has D = 0 when 36 - 4k = 0 -> k = 9" },
    ],
    caution:
      "Always square negative b in parentheses: (-5)^2 = +25, never -25.",
    application:
      "Agribusiness models check D >= 0 before projecting break-even crop harvests to ensure real threshold solutions exist.",
    matchingPairs: [
      { id: "w3-p1", left: "x^2 - 6x + 9 = 0", right: "One real root (D = 0)" },
      { id: "w3-p2", left: "x^2 + 2x + 5 = 0", right: "No real roots (D = -16)" },
      { id: "w3-p3", left: "2x^2 - 5x - 3 = 0", right: "Two rational roots (D = 49)" },
      { id: "w3-p4", left: "x^2 - 2x - 2 = 0", right: "Two irrational roots (D = 12)" },
    ],
    practiceItems: [
      {
        id: "w3-s1",
        prompt: "Compute the discriminant D of 2x^2 - 5x - 3 = 0.",
        expectedHash: syncSaltedHash(49, "w3-s1"),
        solutionSteps: [
          "Identify a = 2, b = -5, c = -3.",
          "D = (-5)^2 - 4(2)(-3) = 25 + 24 = 49.",
        ],
      },
      {
        id: "w3-s2",
        prompt: "Find k so that x^2 - 8x + k = 0 has exactly one real root.",
        expectedHash: syncSaltedHash(16, "w3-s2"),
        solutionSteps: [
          "Set D = 0: (-8)^2 - 4(1)(k) = 0.",
          "64 - 4k = 0 -> k = 16.",
        ],
      },
    ],
    scenarioContext:
      "A cacao farm's break-even equation is x^2 - 6x + k = 0, where x is cultivated hectares and k is a cost parameter.",
    scenarioQuestions: [
      {
        id: "w3-q1",
        prompt: "What value of k gives exactly one real break-even point?",
        options: ["k = 6", "k = 9", "k = 36", "k = 3"],
        correctHash: syncSaltedHash(1, "w3-q1-salt"),
        salt: "w3-q1-salt",
        explanation: "(-6)^2 - 4(1)(k) = 0 -> 36 = 4k -> k = 9.",
      },
      {
        id: "w3-q2",
        prompt: "If k = 5, what is the nature of the solutions?",
        options: ["One real root", "No real roots", "Two distinct real roots (D = 16)", "Cannot be determined"],
        correctHash: syncSaltedHash(2, "w3-q2-salt"),
        salt: "w3-q2-salt",
        explanation: "D = 36 - 4(5) = 16 > 0, giving two distinct real roots.",
      },
    ],
    reflectionPrompt:
      "How does the discriminant show the number of x-intercepts of a parabola before graphing it?",
  },
  {
    id: "w4-quadratic-functions",
    weekNumber: 4,
    topicCode: "D",
    title: "Quadratic Functions & Reducible Equations",
    competency:
      "Derive quadratic equations from zeros, vertex, or points, and solve equations reducible to quadratic form.",
    principles: [
      "Standard form: y = ax^2 + bx + c; Vertex form: y = a(x - h)^2 + k; Intercept form: y = a(x - p)(x - q).",
      "For ax^4 + bx^2 + c = 0, substitute u = x^2, solve for u, then back-substitute x = +/- sqrt(u).",
      "For x + b*sqrt(x) + c = 0, substitute u = sqrt(x) and verify non-negative roots.",
    ],
    steps: [
      "Plug given zeros (p, q) or vertex (h, k) into the matching quadratic template.",
      "Substitute an extra known point (x, y) to solve for leading coefficient a.",
      "For higher-degree equations, rewrite using auxiliary variable u, solve, and check back-substitution.",
    ],
    examples: [
      { label: "From zeros", steps: "Zeros 2 and 5, a = 1 -> y = (x - 2)(x - 5) = x^2 - 7x + 10" },
      { label: "From vertex", steps: "Vertex (1, -4), a = 1 -> y = (x - 1)^2 - 4 = x^2 - 2x - 3" },
      { label: "Biquadratic u-sub", steps: "x^4 - 5x^2 + 4 = 0 -> (u - 1)(u - 4) = 0 -> x = +/-1, +/-2" },
    ],
    caution:
      "Never stop at finding u. Remember both + and - roots when solving x^2 = u, and check extraneous roots for u = sqrt(x).",
    application:
      "Bridge arches and parabolic drainage culverts use intercept form y = a(x - p)(x - q) to compute road clearance at any span point.",
    matchingPairs: [
      { id: "w4-p1", left: "Zeros 2 and 5, a = 1", right: "y = x^2 - 7x + 10" },
      { id: "w4-p2", left: "Zeros -3 and 4, a = 1", right: "y = x^2 - x - 12" },
      { id: "w4-p3", left: "Vertex (1, -4), a = 1", right: "y = x^2 - 2x - 3" },
      { id: "w4-p4", left: "x^4 - 5x^2 + 4 = 0", right: "x = +/-1, +/-2" },
    ],
    practiceItems: [
      {
        id: "w4-s1",
        prompt: "A quadratic has zeros 2 and 5 with a = 1. Find linear coefficient b.",
        expectedHash: syncSaltedHash(-7, "w4-s1"),
        solutionSteps: [
          "Expand y = (x - 2)(x - 5) = x^2 - 7x + 10.",
          "The linear coefficient b of x is -7.",
        ],
      },
      {
        id: "w4-s2",
        prompt: "Find the sum of the positive solutions of x^4 - 5x^2 + 4 = 0.",
        expectedHash: syncSaltedHash(3, "w4-s2"),
        solutionSteps: [
          "u^2 - 5u + 4 = 0 gives u = 1 and u = 4.",
          "Positive x values are 1 and 2, so sum = 1 + 2 = 3.",
        ],
      },
    ],
    scenarioContext:
      "A bridge parabolic arch meets ground level at x = 0 m and x = 10 m, peaking at height 5 m at x = 5 m.",
    scenarioQuestions: [
      {
        id: "w4-q1",
        prompt: "Which quadratic function models the arch?",
        options: ["y = -x^2 + 10x", "y = (1/5)x^2 - 2x", "y = -5x^2 + 50x", "y = -(1/5)x^2 + 2x"],
        correctHash: syncSaltedHash(3, "w4-q1-salt"),
        salt: "w4-q1-salt",
        explanation: "y = ax(x - 10). At (5, 5): 5 = a(5)(-5) -> a = -1/5 -> y = -(1/5)x^2 + 2x.",
      },
      {
        id: "w4-q2",
        prompt: "What is the arch clearance at x = 2 m?",
        options: ["3.2 m", "4 m", "2.4 m", "3.6 m"],
        correctHash: syncSaltedHash(0, "w4-q2-salt"),
        salt: "w4-q2-salt",
        explanation: "y(2) = -(1/5)(4) + 2(2) = -0.8 + 4 = 3.2 m.",
      },
    ],
    reflectionPrompt:
      "Why is a third non-zero point required to pin down the exact parabola when you already know both x-intercepts?",
  },
  {
    id: "w5-optimization",
    weekNumber: 5,
    topicCode: "E",
    title: "Quadratic Optimization",
    competency:
      "Solve applied maximum and minimum problems using parabola vertex formulas.",
    principles: [
      "For f(x) = ax^2 + bx + c: if a > 0, minimum occurs at vertex; if a < 0, maximum occurs at vertex.",
      "Vertex occurs at h = -b / (2a), with optimal output k = f(h).",
    ],
    steps: [
      "Define the variable and write a single-variable quadratic expression.",
      "Compute h = -b / (2a) to locate where the optimum happens.",
      "Evaluate f(h) for the actual maximum or minimum quantity.",
    ],
    examples: [
      { label: "Projectile peak", steps: "h(t) = -t^2 + 6t peaks at t = -6/-2 = 3s, max height = 9m" },
      { label: "Fencing area", steps: "40m perimeter -> A(x) = x(20 - x) peaks at x = 10m -> 100 m^2" },
    ],
    caution:
      "Keep h (input location) and k (maximum/minimum value) straight, and reject impossible negative times or lengths.",
    application:
      "Eco-resort pricing and fencing enclosures balance competing constraints at the parabola vertex.",
    matchingPairs: [
      { id: "w5-p1", left: "Maximum of y = -x^2 + 6x", right: "9" },
      { id: "w5-p2", left: "Vertex x of y = x^2 - 4x + 7", right: "2" },
      { id: "w5-p3", left: "Zeros of y = x^2 - 9", right: "x = +/-3" },
      { id: "w5-p4", left: "Maximum of R = -2x^2 + 40x", right: "200" },
    ],
    practiceItems: [
      {
        id: "w5-s1",
        prompt: "Height is modeled by h = -t^2 + 6t meters. Find maximum height in meters.",
        expectedHash: syncSaltedHash(9, "w5-s1"),
        solutionSteps: [
          "t = -6 / (2 * -1) = 3 s.",
          "h(3) = -(3)^2 + 6(3) = -9 + 18 = 9 m.",
        ],
      },
      {
        id: "w5-s2",
        prompt: "At what time t > 0 (seconds) does the projectile return to h = 0?",
        expectedHash: syncSaltedHash(6, "w5-s2"),
        solutionSteps: [
          "-t^2 + 6t = 0 -> t(-t + 6) = 0.",
          "For t > 0, t = 6 s.",
        ],
      },
    ],
    scenarioContext:
      "A resort models projected revenue (in thousand pesos) by R(x) = -2x^2 + 40x for x rate reductions.",
    scenarioQuestions: [
      {
        id: "w5-q1",
        prompt: "What is the maximum attainable revenue (in thousand pesos)?",
        options: ["100", "200", "400", "20"],
        correctHash: syncSaltedHash(1, "w5-q1-salt"),
        salt: "w5-q1-salt",
        explanation: "x = -40 / (2 * -2) = 10; R(10) = -200 + 400 = 200.",
      },
      {
        id: "w5-q2",
        prompt: "For x > 0, when does projected revenue fall to zero?",
        options: ["x = 10", "x = 40", "x = 20", "x = 5"],
        correctHash: syncSaltedHash(2, "w5-q2-salt"),
        salt: "w5-q2-salt",
        explanation: "-2x(x - 20) = 0 gives x = 20.",
      },
    ],
    reflectionPrompt:
      "Describe an everyday budgeting, packaging, or sports optimization problem you could solve with a quadratic vertex.",
  },
  {
    id: "w6-radical-eq-circles",
    weekNumber: 6,
    topicCode: "F",
    title: "Radical Equations & Circle Forms",
    competency:
      "Solve radical equations with extraneous-root verification and convert circle equations between standard and general forms.",
    principles: [
      "Squaring both sides can create extraneous solutions; every candidate root must be plugged back into the original equation.",
      "Circle standard form: (x - h)^2 + (y - k)^2 = r^2. General form: x^2 + y^2 + Dx + Ey + F = 0.",
    ],
    steps: [
      "Isolate the radical expression before squaring both sides.",
      "Verify each candidate root in the un-squared original equation.",
      "Convert general circle form to standard form by completing the square on x and y.",
    ],
    examples: [
      { label: "Extraneous check", steps: "sqrt(2x - 1) = x - 2 -> x = 1 (fails: 1 != -1) or x = 5 (valid)" },
      { label: "Completing square", steps: "x^2 + y^2 - 4x + 6y - 12 = 0 -> (x - 2)^2 + (y + 3)^2 = 25" },
    ],
    caution:
      "Principal square roots are never negative. Never omit checking roots after squaring both sides.",
    application:
      "Water pressure equations use radical roots, while municipal zone boundaries convert general GPS circle equations into center-radius models.",
    matchingPairs: [
      { id: "w6-p1", left: "sqrt(x + 3) = 4", right: "x = 13" },
      { id: "w6-p2", left: "sqrt(2x - 1) = x - 2", right: "x = 5 only (1 extraneous)" },
      { id: "w6-p3", left: "(x - 3)^2 + (y + 2)^2 = 36", right: "x^2 + y^2 - 6x + 4y - 23 = 0" },
      { id: "w6-p4", left: "x^2 + y^2 - 4x + 6y - 12 = 0", right: "(x - 2)^2 + (y + 3)^2 = 25" },
    ],
    practiceItems: [
      {
        id: "w6-s1",
        prompt: "Solve sqrt(x + 3) = 4 for x.",
        expectedHash: syncSaltedHash(13, "w6-s1"),
        solutionSteps: ["Square both sides: x + 3 = 16.", "x = 13 (check: sqrt(16) = 4)."],
      },
      {
        id: "w6-s2",
        prompt: "Find radius r of the circle x^2 + y^2 - 6x + 4y - 23 = 0.",
        expectedHash: syncSaltedHash(6, "w6-s2"),
        solutionSteps: [
          "(x - 3)^2 + (y + 2)^2 = 23 + 9 + 4 = 36.",
          "r = sqrt(36) = 6.",
        ],
      },
    ],
    scenarioContext:
      "A municipal pipeline pressure relation satisfies sqrt(3x + 4) = x.",
    scenarioQuestions: [
      {
        id: "w6-q1",
        prompt: "Which solution(s) remain valid after checking?",
        options: ["x = 4 and x = -1", "x = -1 only", "x = 2", "x = 4 only"],
        correctHash: syncSaltedHash(3, "w6-q1-salt"),
        salt: "w6-q1-salt",
        explanation: "3x + 4 = x^2 -> x = 4 or -1. Since sqrt(3(-1)+4) = 1 != -1, only x = 4 is valid.",
      },
      {
        id: "w6-q2",
        prompt: "Why is x = -1 rejected?",
        options: [
          "The right side becomes -1, whereas a principal square root cannot be negative",
          "Negative numbers cannot appear in geometry",
          "It is irrational",
          "Rounding error",
        ],
        correctHash: syncSaltedHash(0, "w6-q2-salt"),
        salt: "w6-q2-salt",
        explanation: "A principal square root is always >= 0, so it cannot equal -1.",
      },
    ],
    reflectionPrompt:
      "Explain why squaring an equation is non-reversible and why substitution verification protects your solution.",
  },
  {
    id: "w7-center-radius",
    weekNumber: 7,
    topicCode: "G",
    title: "Center & Radius of a Circle",
    competency:
      "Identify center coordinates (h, k) and radius r from both standard and general forms of a circle.",
    principles: [
      "Standard form (x - h)^2 + (y - k)^2 = r^2 reverses binomial signs: (x + 1)^2 means h = -1.",
      "Origin circle: x^2 + y^2 = r^2 has center (0, 0).",
      "From x^2 + y^2 + Dx + Ey + F = 0: center = (-D/2, -E/2) and r = sqrt(h^2 + k^2 - F).",
    ],
    steps: [
      "Make sure coefficients of x^2 and y^2 are 1.",
      "Read opposite signs inside (x - h)^2 and (y - k)^2.",
      "Take the square root of the right-hand constant to get r (not r^2).",
    ],
    examples: [
      { label: "Standard reading", steps: "(x + 1)^2 + (y - 4)^2 = 25 -> Center (-1, 4), r = 5" },
      { label: "General shortcut", steps: "x^2 + y^2 - 8x + 6y - 24 = 0 -> Center (4, -3), r = sqrt(16+9+24) = 7" },
    ],
    caution:
      "Do not report r^2 as the radius: if the right-hand side is 49, r = 7.",
    application:
      "Roundabout geometry on city maps uses center coordinates and radius lengths to lay out lanes cleanly.",
    matchingPairs: [
      { id: "w7-p1", left: "(x - 2)^2 + (y - 3)^2 = 100", right: "C(2, 3), r = 10" },
      { id: "w7-p2", left: "x^2 + y^2 = 49", right: "C(0, 0), r = 7" },
      { id: "w7-p3", left: "(x + 1)^2 + (y - 4)^2 = 25", right: "C(-1, 4), r = 5" },
      { id: "w7-p4", left: "x^2 + y^2 - 8x + 6y - 24 = 0", right: "C(4, -3), r = 7" },
    ],
    practiceItems: [
      {
        id: "w7-s1",
        prompt: "Find radius r of (x - 4)^2 + (y + 3)^2 = 49.",
        expectedHash: syncSaltedHash(7, "w7-s1"),
        solutionSteps: ["r^2 = 49, so r = sqrt(49) = 7."],
      },
      {
        id: "w7-s2",
        prompt: "Compute h + k for the center (h, k) of (x - 4)^2 + (y + 3)^2 = 49.",
        expectedHash: syncSaltedHash(1, "w7-s2"),
        solutionSteps: ["Center is (4, -3), so h + k = 4 + (-3) = 1."],
      },
    ],
    scenarioContext:
      "On a city coordinate grid, the central roundabout is centered at (4, -2) with radius 3 units.",
    scenarioQuestions: [
      {
        id: "w7-q1",
        prompt: "What is its center-radius equation?",
        options: [
          "(x + 4)^2 + (y - 2)^2 = 9",
          "(x - 4)^2 + (y + 2)^2 = 9",
          "(x - 4)^2 + (y + 2)^2 = 3",
          "(x - 4)^2 + (y - 2)^2 = 9",
        ],
        correctHash: syncSaltedHash(1, "w7-q1-salt"),
        salt: "w7-q1-salt",
        explanation: "Plug h = 4, k = -2, r = 3 into (x - h)^2 + (y - k)^2 = r^2 -> (x - 4)^2 + (y + 2)^2 = 9.",
      },
      {
        id: "w7-q2",
        prompt: "Convert that equation to general form.",
        options: [
          "x^2 + y^2 + 8x - 4y + 11 = 0",
          "x^2 + y^2 - 8x + 4y - 11 = 0",
          "x^2 + y^2 - 8x + 4y + 11 = 0",
          "x^2 + y^2 - 8x + 4y + 29 = 0",
        ],
        correctHash: syncSaltedHash(2, "w7-q2-salt"),
        salt: "w7-q2-salt",
        explanation: "(x^2 - 8x + 16) + (y^2 + 4y + 4) - 9 = 0 -> x^2 + y^2 - 8x + 4y + 11 = 0.",
      },
    ],
    reflectionPrompt:
      "Explain why (x + 3)^2 shifts the circle center left to x = -3 instead of +3.",
  },
  {
    id: "w8-point-circle",
    weekNumber: 8,
    topicCode: "G",
    title: "Graphing & Point-Circle Position",
    competency:
      "Plot circles using cardinal boundary points and test whether a coordinate point is inside, on, or outside the boundary.",
    principles: [
      "Cardinal points around (h, k): (h +/- r, k) and (h, k +/- r).",
      "Let d^2 = (x - h)^2 + (y - k)^2. Interior: d^2 < r^2; On boundary: d^2 = r^2; Exterior: d^2 > r^2.",
    ],
    steps: [
      "Identify center (h, k) and r^2.",
      "Substitute test point (x, y) into (x - h)^2 + (y - k)^2 to evaluate d^2.",
      "Compare d^2 against r^2 (not r).",
    ],
    examples: [
      { label: "Boundary test", steps: "Point (8, 11) for (x - 2)^2 + (y - 3)^2 = 100 -> 36 + 64 = 100 (On circle)" },
      { label: "Interior test", steps: "Point (5, 7) -> 9 + 16 = 25 < 100 (Inside circle)" },
    ],
    caution:
      "Never compare squared distance d^2 with unsquared radius r.",
    application:
      "Wireless signal towers service every household satisfying d^2 <= r^2.",
    matchingPairs: [
      { id: "w8-p1", left: "(8, 11) in C(2,3), r^2=100", right: "On the circle (d^2 = 100)" },
      { id: "w8-p2", left: "(5, 7) in C(2,3), r^2=100", right: "Inside (d^2 = 25)" },
      { id: "w8-p3", left: "(11, 13) in C(2,3), r^2=100", right: "Outside (d^2 = 181)" },
      { id: "w8-p4", left: "(4, 4) in C(4,-3), r^2=49", right: "On the circle (d^2 = 49)" },
    ],
    practiceItems: [
      {
        id: "w8-s1",
        prompt: "Calculate the diameter of (x - 2)^2 + (y - 3)^2 = 100.",
        expectedHash: syncSaltedHash(20, "w8-s1"),
        solutionSteps: ["r = 10, so diameter = 2r = 20."],
      },
      {
        id: "w8-s2",
        prompt: "Find the distance between (6, 3) and center (2, 3).",
        expectedHash: syncSaltedHash(4, "w8-s2"),
        solutionSteps: ["|6 - 2| = 4."],
      },
    ],
    scenarioContext:
      "A municipal Wi-Fi tower coverage zone is modeled by (x - 2)^2 + (y - 3)^2 = 100 (meters).",
    scenarioQuestions: [
      {
        id: "w8-q1",
        prompt: "Where is a home at (8, 11) relative to the zone?",
        options: ["Inside the zone", "Outside the zone", "Cannot be determined", "On the boundary"],
        correctHash: syncSaltedHash(3, "w8-q1-salt"),
        salt: "w8-q1-salt",
        explanation: "(8 - 2)^2 + (11 - 3)^2 = 36 + 64 = 100 = r^2 -> On the boundary.",
      },
      {
        id: "w8-q2",
        prompt: "Which coordinate lies outside the coverage zone?",
        options: ["(11, 13)", "(5, 7)", "(-6, 3)", "(2, -6)"],
        correctHash: syncSaltedHash(0, "w8-q2-salt"),
        salt: "w8-q2-salt",
        explanation: "At (11, 13): 9^2 + 10^2 = 181 > 100.",
      },
    ],
    reflectionPrompt:
      "Why is checking d^2 against r^2 exact, whereas guessing from a hand-drawn sketch can fail near the edge?",
  },
  {
    id: "w9-deriving-circles",
    weekNumber: 9,
    topicCode: "G",
    title: "Deriving Circle Equations",
    competency:
      "Write circle equations given diameter endpoints, center + point, or axis tangency conditions.",
    principles: [
      "Midpoint M = ((x1 + x2)/2, (y1 + y2)/2); Distance d = sqrt((x2 - x1)^2 + (y2 - y1)^2).",
      "Diameter endpoints give center as midpoint and r = d / 2.",
      "Tangent to x-axis -> r = |k|; tangent to y-axis -> r = |h|.",
    ],
    steps: [
      "Compute center (h, k) via the midpoint formula if diameter endpoints are given.",
      "Compute squared radius r^2 from center to an endpoint or boundary point.",
      "Plug (h, k) and r^2 into (x - h)^2 + (y - k)^2 = r^2.",
    ],
    examples: [
      { label: "Horizontal diameter", steps: "Endpoints (-2, 0) & (6, 0) -> C(2, 0), r = 4 -> (x - 2)^2 + y^2 = 16" },
      { label: "Diagonal diameter", steps: "Endpoints (1, 2) & (5, 6) -> C(3, 4), r^2 = 8 -> (x - 3)^2 + (y - 4)^2 = 8" },
    ],
    caution:
      "Always halve the diameter before squaring for r^2.",
    application:
      "Athletic track layout marks diameter ends on survey grids before computing exact lane curves.",
    matchingPairs: [
      { id: "w9-p1", left: "Diameter (-2, 0) to (6, 0)", right: "(x - 2)^2 + y^2 = 16" },
      { id: "w9-p2", left: "Diameter (1, 2) to (5, 6)", right: "(x - 3)^2 + (y - 4)^2 = 8" },
      { id: "w9-p3", left: "Midpoint of (0,0) and (4,-2)", right: "(2, -1)" },
      { id: "w9-p4", left: "Distance (0,0) to (-3,5)", right: "sqrt(34)" },
    ],
    practiceItems: [
      {
        id: "w9-s1",
        prompt: "Diameter endpoints are (1, 2) and (5, 6). Find r^2.",
        expectedHash: syncSaltedHash(8, "w9-s1"),
        solutionSteps: ["Midpoint = (3, 4). r^2 = (5 - 3)^2 + (6 - 4)^2 = 4 + 4 = 8."],
      },
      {
        id: "w9-s2",
        prompt: "Sum the coordinates (x + y) of the midpoint between (0, 0) and (4, -2).",
        expectedHash: syncSaltedHash(1, "w9-s2"),
        solutionSteps: ["Midpoint is (2, -1). Sum = 2 + (-1) = 1."],
      },
    ],
    scenarioContext:
      "A circular running track has diameter endpoints (-2, 0) and (6, 0), where 1 grid unit = 10 meters.",
    scenarioQuestions: [
      {
        id: "w9-q1",
        prompt: "Find the track's standard equation.",
        options: [
          "(x - 2)^2 + y^2 = 4",
          "(x - 2)^2 + y^2 = 16",
          "(x + 2)^2 + y^2 = 16",
          "x^2 + y^2 = 16",
        ],
        correctHash: syncSaltedHash(1, "w9-q1-salt"),
        salt: "w9-q1-salt",
        explanation: "Center = (2, 0), diameter = 8, r = 4 -> (x - 2)^2 + y^2 = 16.",
      },
      {
        id: "w9-q2",
        prompt: "What is the physical diameter in meters?",
        options: ["40 m", "160 m", "80 m", "8 m"],
        correctHash: syncSaltedHash(2, "w9-q2-salt"),
        salt: "w9-q2-salt",
        explanation: "8 units * 10 m/unit = 80 m.",
      },
    ],
    reflectionPrompt:
      "Outline the two-step calculation that turns any diameter pair into a circle equation.",
  },
  {
    id: "w10-coordinate-apps",
    weekNumber: 10,
    topicCode: "G",
    title: "Cartesian Geometry & Tangents",
    competency:
      "Combine midpoints, Euclidean distances, and vertical/horizontal tangent lines to solve multi-step spatial planning problems.",
    principles: [
      "A tangent is perpendicular to the radius at the point of tangency.",
      "Distance from center (h, k) to vertical line x = c is r = |c - h|; to horizontal line y = c is r = |c - k|.",
    ],
    steps: [
      "Tabulate landmark coordinates and scale factors.",
      "Use midpoint/distance or tangent offsets to compute (h, k) and r^2.",
      "Multiply unit lengths by map scale to report real-world meters.",
    ],
    examples: [
      { label: "Vertical tangent", steps: "Center (2, -1) tangent to x = 7 -> r = |7 - 2| = 5" },
      { label: "Pedestrian zone", steps: "C(2,-1) with r = sqrt(34) -> at 100 m/unit, r approx 583 m" },
    ],
    caution:
      "Always convert grid units back into physical units (e.g., meters) when map scales are provided.",
    application:
      "Urban planning maps integrate circular plaza zones with road tangents and distance metrics.",
    matchingPairs: [
      { id: "w10-p1", left: "C(2, -1) tangent to x = 7", right: "r = 5" },
      { id: "w10-p2", left: "C(2, -1) tangent to y = 2", right: "r = 3" },
      { id: "w10-p3", left: "Midpoint (0,0) & (4,-2)", right: "(2, -1)" },
      { id: "w10-p4", left: "Distance (0,0) to (-3,5)", right: "sqrt(34)" },
    ],
    practiceItems: [
      {
        id: "w10-s1",
        prompt: "Compute d^2 between (0, 0) and (-3, 5).",
        expectedHash: syncSaltedHash(34, "w10-s1"),
        solutionSteps: ["(-3 - 0)^2 + (5 - 0)^2 = 9 + 25 = 34."],
      },
      {
        id: "w10-s2",
        prompt: "Using 1 unit = 100 m, convert sqrt(34) units to meters (nearest integer).",
        expectedHash: syncSaltedHash(583, "w10-s2"),
        solutionSteps: ["sqrt(34) approx 5.83095 -> * 100 approx 583 m."],
      },
    ],
    scenarioContext:
      "Grid sites (1 unit = 100 m): City Hall (0, 0), Rotonda (4, -2), Sports Complex (-3, 5). A pedestrian circle is centered midway between City Hall and Rotonda with radius equal to distance from City Hall to Sports Complex.",
    scenarioQuestions: [
      {
        id: "w10-q1",
        prompt: "What is the standard equation of the pedestrian zone?",
        options: [
          "(x - 2)^2 + (y + 1)^2 = sqrt(34)",
          "(x + 2)^2 + (y - 1)^2 = 34",
          "(x - 4)^2 + (y + 2)^2 = 34",
          "(x - 2)^2 + (y + 1)^2 = 34",
        ],
        correctHash: syncSaltedHash(3, "w10-q1-salt"),
        salt: "w10-q1-salt",
        explanation: "Midpoint = (2, -1), r^2 = (-3)^2 + 5^2 = 34 -> (x - 2)^2 + (y + 1)^2 = 34.",
      },
      {
        id: "w10-q2",
        prompt: "Estimate the physical radius to the nearest meter.",
        options: ["583 m", "34 m", "340 m", "5.8 m"],
        correctHash: syncSaltedHash(0, "w10-q2-salt"),
        salt: "w10-q2-salt",
        explanation: "sqrt(34) approx 5.831 * 100 approx 583 m.",
      },
    ],
    reflectionPrompt:
      "Reflect on how algebraic formulas and coordinate maps work together in real-world spatial planning.",
  },
];

export const DIAGNOSTIC_25_ITEMS: QuizBlueprintItem[] = [
  { id: "d1", topicCode: "A", prompt: "Evaluate 16^(3/4).", options: ["12", "8", "64", "4"], correctIndex: 1, points: 1 },
  { id: "d2", topicCode: "A", prompt: "Express sqrt(48) in simplest radical form.", options: ["2sqrt(12)", "6sqrt(2)", "4sqrt(3)", "12sqrt(4)"], correctIndex: 2, points: 1 },
  { id: "d3", topicCode: "A", prompt: "Which radical expression equals 5^(1/2)?", options: ["5 / 2", "root[3](5)", "1 / 5", "sqrt(5)"], correctIndex: 3, points: 1 },
  { id: "d4", topicCode: "A", prompt: "A square grain pavement has area 98 m^2. Find its side length in simplest radical form.", options: ["7sqrt(2) m", "2sqrt(49) m", "49sqrt(2) m", "14 m"], correctIndex: 0, points: 1 },
  { id: "d5", topicCode: "B", prompt: "Simplify 4sqrt(3) + 2sqrt(3).", options: ["6sqrt(6)", "6sqrt(3)", "8sqrt(3)", "6sqrt(9)"], correctIndex: 1, points: 1 },
  { id: "d6", topicCode: "B", prompt: "Compute sqrt(6) * sqrt(3) in simplest form.", options: ["sqrt(9)", "9sqrt(2)", "3sqrt(2)", "2sqrt(3)"], correctIndex: 2, points: 1 },
  { id: "d7", topicCode: "B", prompt: "Rationalize 5 / sqrt(5).", options: ["5sqrt(5)", "1 / sqrt(5)", "5", "sqrt(5)"], correctIndex: 3, points: 1 },
  { id: "d8", topicCode: "B", prompt: "Rationalize 6 / (2 + sqrt(2)).", options: ["6 - 3sqrt(2)", "6 + 3sqrt(2)", "(12 - 6sqrt(2)) / 6", "3sqrt(2) - 6"], correctIndex: 0, points: 1 },
  { id: "d9", topicCode: "C", prompt: "Compute the discriminant of 2x^2 - 3x - 5 = 0.", options: ["-31", "49", "31", "-49"], correctIndex: 1, points: 1 },
  { id: "d10", topicCode: "C", prompt: "Classify the roots of x^2 - 4x + 4 = 0.", options: ["Two distinct rational roots", "No real roots", "One real root (multiplicity two)", "Two distinct irrational roots"], correctIndex: 2, points: 1 },
  { id: "d11", topicCode: "C", prompt: "For x^2 + 6x + k = 0 to have no real roots, which value of k works?", options: ["k = 9", "k = 5", "k = 0", "k = 10"], correctIndex: 3, points: 1 },
  { id: "d12", topicCode: "D", prompt: "Find the quadratic with zeros 3 and -2 and a = 1.", options: ["y = x^2 - x - 6", "y = x^2 + x - 6", "y = x^2 - 5x - 6", "y = x^2 - x + 6"], correctIndex: 0, points: 1 },
  { id: "d13", topicCode: "D", prompt: "Identify the quadratic passing through (0, 3), (1, 0), and (2, -1).", options: ["y = x^2 + 4x + 3", "y = x^2 - 4x + 3", "y = -x^2 + 4x - 3", "y = x^2 - 3x + 3"], correctIndex: 1, points: 1 },
  { id: "d14", topicCode: "D", prompt: "How many distinct real solutions satisfy x^4 - 13x^2 + 36 = 0?", options: ["2", "8", "4", "0"], correctIndex: 2, points: 1 },
  { id: "d15", topicCode: "D", prompt: "Which substitution turns x^4 + 5x^2 + 4 = 0 into a quadratic?", options: ["u = x^4", "u = x", "u = x + 2", "u = x^2"], correctIndex: 3, points: 1 },
  { id: "d16", topicCode: "E", prompt: "80 m of fencing encloses a rectangular farm plot. Find the maximum area.", options: ["400 m^2", "800 m^2", "1600 m^2", "200 m^2"], correctIndex: 0, points: 1 },
  { id: "d17", topicCode: "E", prompt: "Altitude is h = -5t^2 + 30t meters. Find the maximum height.", options: ["90 m", "45 m", "30 m", "3 m"], correctIndex: 1, points: 1 },
  { id: "d18", topicCode: "F", prompt: "Solve sqrt(x + 7) = 3.", options: ["x = 16", "x = -4", "x = 2", "x = 10"], correctIndex: 2, points: 1 },
  { id: "d19", topicCode: "F", prompt: "Find the valid solution set of sqrt(x + 2) = x.", options: ["x = -1", "x = 2 and x = -1", "Empty set", "x = 2"], correctIndex: 3, points: 1 },
  { id: "d20", topicCode: "F", prompt: "Free-fall time is t = sqrt(h / 5) s. If t = 3 s, find height h.", options: ["45 m", "15 m", "9 m", "30 m"], correctIndex: 0, points: 1 },
  { id: "d21", topicCode: "G", prompt: "Identify center and radius of (x - 4)^2 + (y + 1)^2 = 36.", options: ["C(-4, 1), r = 6", "C(4, -1), r = 6", "C(4, -1), r = 36", "C(4, 1), r = 6"], correctIndex: 1, points: 1 },
  { id: "d22", topicCode: "G", prompt: "Write the circle with center (1, 2) and radius 3 in general form.", options: ["x^2 + y^2 + 2x + 4y - 4 = 0", "x^2 + y^2 - 2x - 4y + 4 = 0", "x^2 + y^2 - 2x - 4y - 4 = 0", "x^2 + y^2 - 2x - 4y - 9 = 0"], correctIndex: 2, points: 1 },
  { id: "d23", topicCode: "G", prompt: "Find center and radius of x^2 + y^2 - 8x + 6y + 9 = 0.", options: ["C(-4, 3), r = 4", "C(4, -3), r = 16", "C(4, -3), r = 2", "C(4, -3), r = 4"], correctIndex: 3, points: 1 },
  { id: "d24", topicCode: "G", prompt: "Equation of circle with diameter endpoints (-2, 1) and (4, 9):", options: ["(x - 1)^2 + (y - 5)^2 = 25", "(x + 1)^2 + (y + 5)^2 = 25", "(x - 1)^2 + (y - 5)^2 = 10", "(x - 1)^2 + (y - 5)^2 = 5"], correctIndex: 0, points: 1 },
  { id: "d25", topicCode: "G", prompt: "Tower coverage is x^2 + y^2 = 100. Which point lies outside?", options: ["(6, 8)", "(8, 7)", "(5, 5)", "(0, -10)"], correctIndex: 1, points: 1 },
];

export const MASTERY_7_ITEMS: QuizBlueprintItem[] = [
  {
    id: "m1",
    topicCode: "B",
    prompt: "A decorative ribbon measures 10 / sqrt(5) m. Rationalize the denominator.",
    options: ["5sqrt(2) m", "2sqrt(5) m", "sqrt(5) m", "10sqrt(5) m"],
    correctIndex: 1,
    points: 1,
    explanation: "(10 * sqrt(5)) / 5 = 2sqrt(5) m.",
  },
  {
    id: "m2",
    topicCode: "C",
    prompt: "Does the parabolic profile 3x^2 - 4x + 5 = 0 intersect the horizontal axis?",
    options: ["Yes, since D = 44", "Yes, since D = 76", "No, since D = -44 indicates no real roots", "No, since D = 0"],
    correctIndex: 2,
    points: 1,
    explanation: "D = (-4)^2 - 4(3)(5) = 16 - 60 = -44 < 0 -> no x-axis intersection.",
  },
  {
    id: "m3",
    topicCode: "E",
    prompt: "Revenue is R(x) = -2x^2 + 40x. Which value of x maximizes revenue?",
    options: ["x = 20", "x = 40", "x = 5", "x = 10"],
    correctIndex: 3,
    points: 1,
    explanation: "Vertex x = -40 / (2 * -2) = 10.",
  },
  {
    id: "m4",
    topicCode: "D",
    prompt: "How many distinct real solutions solve x^4 - 13x^2 + 36 = 0?",
    options: ["4", "2", "3", "1"],
    correctIndex: 0,
    points: 1,
    explanation: "(x^2 - 4)(x^2 - 9) = 0 -> x = +/-2, +/-3 (4 solutions).",
  },
  {
    id: "m5",
    topicCode: "G",
    prompt: "Find center and radius of x^2 + y^2 - 10x + 4y + 20 = 0.",
    options: ["(-5, 2), r = 3", "(5, -2), r = 3", "(5, -2), r = 9", "(-5, 2), r = 9"],
    correctIndex: 1,
    points: 1,
    explanation: "(x - 5)^2 + (y + 2)^2 = 9 -> Center (5, -2), r = 3.",
  },
  {
    id: "m6",
    topicCode: "G",
    prompt: "Classify point (0, 0) relative to x^2 + y^2 - 8x + 6y - 24 = 0.",
    options: ["On the boundary", "Outside the plaza", "Inside the plaza", "At the center"],
    correctIndex: 2,
    points: 1,
    explanation: "(x - 4)^2 + (y + 3)^2 = 49. At (0,0): 16 + 9 = 25 < 49 -> Inside.",
  },
  {
    id: "m7",
    topicCode: "G",
    prompt: "A line x = 7 is tangent to a circle centered at (2, -1). Find the circle equation.",
    options: ["(x - 2)^2 + (y + 1)^2 = 5", "(x - 2)^2 + (y + 1)^2 = 49", "(x - 2)^2 + (y + 1)^2 = 16", "(x - 2)^2 + (y + 1)^2 = 25"],
    correctIndex: 3,
    points: 1,
    explanation: "Radius r = |7 - 2| = 5 -> r^2 = 25.",
  },
];

export const GRADE10_BLUEPRINTS: QuizBlueprint[] = [
  {
    id: "g10-q2-diagnostic",
    title: "Grade 10 Math Q2: Diagnostic Assessment",
    subject: "Mathematics 10 (Term 2)",
    description: "25-item comprehensive check across radicals, quadratics, optimization, and circles.",
    durationMinutes: 30,
    instantFeedback: false,
    allowRetry: false,
    items: DIAGNOSTIC_25_ITEMS,
  },
  {
    id: "g10-q2-mastery",
    title: "Grade 10 Math Q2: Mastery Challenge",
    subject: "Mathematics 10 (Term 2)",
    description: "7 multi-concept synthesis questions with immediate feedback.",
    durationMinutes: 15,
    instantFeedback: true,
    allowRetry: false,
    items: MASTERY_7_ITEMS,
  },
  {
    id: "g10-q2-quick5",
    title: "Grade 10 Math Q2: Quick Checkpoint (5 Items)",
    subject: "Mathematics 10 (Term 2)",
    description: "Short classroom check covering radical equations, discriminants, and circles.",
    durationMinutes: 10,
    instantFeedback: true,
    allowRetry: false,
    items: [DIAGNOSTIC_25_ITEMS[0], DIAGNOSTIC_25_ITEMS[5], DIAGNOSTIC_25_ITEMS[8], DIAGNOSTIC_25_ITEMS[17], DIAGNOSTIC_25_ITEMS[20]],
  },
];

export function toVaultQuestions(items: QuizBlueprintItem[]): VaultQuestion[] {
  return items.map((item) => {
    const salt = `qg_${item.id}_salt`;
    return {
      id: item.id,
      prompt: item.prompt,
      options: item.options,
      correctIndex: item.correctIndex,
      points: item.points,
      topicCode: item.topicCode,
      explanation: item.explanation,
      feedbackSalt: salt,
      correctHash: syncSaltedHash(item.correctIndex, `${item.id}:${salt}`),
    };
  });
}

export async function buildEncryptedPackFromBlueprint(
  blueprint: QuizBlueprint,
  authorName = "Teacher",
  passcode?: string
): Promise<EncryptedQuizPack> {
  const plain: QuizPackPlainPayload = {
    id: blueprint.id,
    title: blueprint.title,
    subject: blueprint.subject,
    description: blueprint.description,
    durationMinutes: blueprint.durationMinutes,
    instantFeedback: blueprint.instantFeedback,
    allowRetry: blueprint.allowRetry,
    createdBy: authorName,
    createdAt: new Date().toISOString(),
    questions: toVaultQuestions(blueprint.items),
  };
  return encryptQuizPack(plain, passcode);
}
