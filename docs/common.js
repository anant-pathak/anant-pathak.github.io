const addNavbar = (currentPage) => {
  console.log("Navbar loaded from:", currentPage); // Debugging log
  const main = document.querySelector("main"); // Select the main element
  if (!main) {
    console.error("No <main> element found!"); // Debugging fallback
    return;
  }

  const nav = document.createElement("nav");
  nav.classList.add(
    "navbar",
    "navbar-expand-md",
    "sticky-top",
    "navbar-light",
    "bg-light"
  );

  const brand = document.createElement("a");
  brand.classList.add("navbar-brand", "ms-2");
  brand.href = "index.html";
  brand.textContent = "anant-pathak.github.io";
  nav.appendChild(brand);

  const button = document.createElement("button");
  button.classList.add("navbar-toggler");
  button.setAttribute("type", "button");
  button.setAttribute("data-bs-toggle", "collapse");
  button.setAttribute("data-bs-target", "#navbarSupportedContent");
  button.setAttribute("aria-controls", "navbarSupportedContent");
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-label", "Toggle navigation");
  button.innerHTML = `<span class="navbar-toggler-icon"></span>`;
  nav.appendChild(button);

  const divCollapse = document.createElement("div");
  divCollapse.classList.add("collapse", "navbar-collapse");
  divCollapse.id = "navbarSupportedContent";

  const ul = document.createElement("ul");
  ul.classList.add("navbar-nav", "me-auto", "mb-2", "mb-lg-0");

  const pages = [
    { href: "index.html", text: "About Me" },
    { href: "cpp_whole.html", text: "C++ Cheat Sheet" },
    { href: "youtube.html", text: "YouTube Vlogs" },
    { href: "contact_me.html", text: "Contact Me" },
  ];

  pages.forEach((page) => {
    const li = document.createElement("li");
    li.classList.add("nav-item");

    const a = document.createElement("a");
    a.classList.add("nav-link");
    a.href = page.href;
    a.textContent = page.text;

    // Highlight the active page
    if (currentPage.includes(page.href)) {
      a.classList.add("active");
    }

    li.appendChild(a);
    ul.appendChild(li);
  });

  divCollapse.appendChild(ul);
  nav.appendChild(divCollapse);

  // Insert the navbar as the FIRST child of <main>
  main.insertBefore(nav, main.firstChild);
};

// Execute the function on page load
addNavbar(window.location.pathname); // Gets the page that called this script);

// Contact me events

document
  .querySelector("#contactMeForm")
  .addEventListener("submit", function (event) {
    event.preventDefault(); // Prevents default form submission

    const formData = new FormData(this);
    const data = Object.fromEntries(formData.entries());
    console.log("Form Data:", data);

    const form = document.querySelector("#contactMeForm");

    const label = document.createElement("section");
    label.className = "d-flex flex-column mt-2 mb-2";
    label.textContent = "Thanks for contacting!";

    form.appendChild(label);
  });
