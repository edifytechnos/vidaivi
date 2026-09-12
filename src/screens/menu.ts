// Rail wiring. The shell is built once and kept, but a delegated listener on
// the document is still the simplest way to bind it: nothing to re-bind, ever.

import { track } from "../analytics";
import { signOut } from "../auth";
import { setGuest } from "../attempts";
import { railExpanded, setRailExpanded } from "../shell";
import { showWelcome } from "./auth";
import { showAdmin, showMyTests, showTeacher } from "./console";
import { showHome } from "./home";
import { showMarking } from "./marking";
import { showChildren } from "./parent";
import { showSubjects } from "./subjects";

/** Bind the rail once, at boot. */
export function installShell(): void {
  document.addEventListener("click", (e) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;

    if (target.closest("#rail-toggle")) {
      setRailExpanded(!railExpanded());
      return;
    }

    // The profile menu in the top bar. Any click that is not the button itself
    // closes it, including a click on one of its own items — which then falls
    // through to the [data-rail] handling below (Sign out lives in there).
    const menu = document.getElementById("profile-menu");
    const btn = document.getElementById("profile-btn");
    if (menu && btn) {
      if (target.closest("#profile-btn")) {
        const open = menu.hidden;
        menu.hidden = !open;
        btn.setAttribute("aria-expanded", String(open));
        return;
      }
      if (!target.closest("#profile-menu")) {
        menu.hidden = true;
        btn.setAttribute("aria-expanded", "false");
      } else {
        menu.hidden = true;
        btn.setAttribute("aria-expanded", "false");
      }
    }

    const item = target.closest<HTMLElement>("[data-rail]");
    if (!item) return;
    const to = item.dataset.rail;
    track("rail_nav", { to: to ?? "" });
    if (to === "subjects") void showSubjects();
    else if (to === "children") void showChildren();
    else if (to === "results") showHome();
    else if (to === "mark") void showMarking();
    else if (to === "students") showTeacher();
    else if (to === "mytests") showMyTests();
    else if (to === "admin") showAdmin();
    else if (to === "signout") {
      track("sign_out");
      signOut();
      setGuest(false);
      showWelcome();
    }
  });
}
