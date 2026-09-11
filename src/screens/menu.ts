// Topbar menu wiring. Screens replace app.innerHTML wholesale, so binding per
// render would mean repeating the same code in every show*(); one delegated
// listener on the document survives every re-render instead.

import { track } from "../analytics";
import { signOut } from "../auth";
import { setGuest } from "../attempts";
import { showWelcome } from "./auth";
import { showAdmin, showMyTests, showTeacher } from "./console";
import { showHome } from "./home";
import { showSubjects } from "./subjects";

function closeMenu(): void {
  const menu = document.getElementById("top-menu");
  const btn = document.getElementById("top-menu-btn");
  if (menu) menu.hidden = true;
  btn?.setAttribute("aria-expanded", "false");
}

/** Bind the topbar menu once, at boot. */
export function installTopbarMenu(): void {
  document.addEventListener("click", (e) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;

    const toggle = target.closest("#top-menu-btn");
    if (toggle) {
      const menu = document.getElementById("top-menu");
      if (!menu) return;
      menu.hidden = !menu.hidden;
      toggle.setAttribute("aria-expanded", String(!menu.hidden));
      return;
    }

    const item = target.closest<HTMLElement>("[data-top-nav]");
    if (!item) {
      closeMenu();
      return;
    }
    closeMenu();
    const to = item.dataset.topNav;
    track("top_nav", { to: to ?? "" });
    if (to === "subjects") void showSubjects();
    else if (to === "students") showTeacher();
    else if (to === "mytests") showMyTests();
    else if (to === "admin") showAdmin();
    else if (to === "signout") {
      track("sign_out");
      signOut();
      setGuest(false);
      showWelcome();
    } else showHome();
  });
}
