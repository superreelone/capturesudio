const cd = window.countdown;
if (!cd) {
  console.error('countdown api missing — countdown loaded in wrong context');
}

const totalSeconds = Math.max(1, Math.min(10, cd?.seconds ?? 3));
const num = document.getElementById('num') as HTMLDivElement;

let remaining = totalSeconds;

function paint(): void {
  num.style.animation = 'none';
  void num.offsetWidth;
  num.style.animation = 'pop 1s ease-in-out';
  num.textContent = String(remaining);
}

paint();

const tick = window.setInterval(() => {
  remaining -= 1;
  if (remaining <= 0) {
    window.clearInterval(tick);
    cd?.done();
    return;
  }
  paint();
}, 1000);

export {};
