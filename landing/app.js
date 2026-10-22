(() => {
  "use strict";
  const options = document.querySelector(".answer-options");
  const feedback = document.getElementById("puzzle-feedback");
  if (!options || !feedback) return;
  const buttons = options.querySelectorAll("button[data-answer]");
  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      buttons.forEach((item) =>
        item.setAttribute("aria-pressed", String(item === button)),
      );
      const correct = button.dataset.answer === "21";
      feedback.textContent = correct
        ? "Aha, you got it! 8 + 13 = 21. The next one would be 34."
        : "Not quite. Try again: add 8 and 13 to find the next number.";
      feedback.dataset.correct = String(correct);
    });
  });
  options.hidden = false;
})();
