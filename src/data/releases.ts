export interface ReleaseSection {
  heading?: string;
  body?: string;
  items?: string[];
  detail?: string;
}

export interface Release {
  version: string;
  title?: string;
  summary?: string;
  sections: ReleaseSection[];
}

// Reconstructed from each version of appcast.xml in the TabTabApp Git history.
export const releases: Release[] = [
  {
    version: "2.1.2",
    title: "Faster and more reliable",
    sections: [
      {
        items: [
          "Made switching to browser tabs much faster, even while TabTab is refreshing in the background",
          "Made tab lists and search more responsive",
          "Fixed stale browser tabs lingering after a window was closed or a browser was quit",
          "Improved reliability when switching to or closing browser tabs and windows",
        ],
      },
    ],
  },
  {
    version: "2.1.1",
    title: "Alphabetic sorting, better favicons, and more",
    sections: [
      {
        items: [
          "Made hovering over items faster and more reliable",
          "Added a new option to sort tabs by alphabetic order",
          "Improved favicon support across more tabs and websites",
          "Added anti-aliasing to make TabTab corners look smoother",
          "Improved switching behaviour when Picture-in-Picture windows are active",
          "Improved the onboarding experience",
        ],
      },
    ],
  },
  {
    version: "2.1",
    title: "The refinement update",
    sections: [
      {
        items: [
          "Refined the interface with softer corners and a more modern macOS feel",
          "Smoother animations throughout the app",
          "Added support for Dia Browser",
          "Fixed an issue that could repeatedly deactivate licenses for some users",
          "Added a larger font size option in settings",
          "Made tab switching and hover interactions much faster, with broader improvements to speed and battery efficiency",
          "Polished mouse activation so TabTab now dismisses automatically when your cursor leaves the active area",
          "Added an option to group tabs by app instead of by window, giving TabTab a more app-switcher-like feel",
          "Apps without visible windows now appear in TabTab by default, with a setting to turn this off",
          "Fixed missing app icons for some apps",
          "Keeping the TabTab settings window open no longer interferes with window switching",
          "Added an option to disable the ripple animation for better performance on older Macs",
          "Fixed switching between apps that share the same name",
          "Restored Figma tabs support",
        ],
      },
    ],
  },
  {
    version: "2.0.4",
    title: "Stability and polish",
    sections: [
      {
        items: [
          "Fixed browser tabs incorrectly jumping to the top of the list",
          "Smoother animations throughout the app",
          "Fixed Firefox vertical tab support",
          "Cmd+A and other modifier key combinations now work correctly in the search bar",
          "TabTab no longer steals focus from other apps",
          "Many smaller bug fixes and improvements",
        ],
      },
    ],
  },
  {
    version: "2.0.3",
    title: "Speed improvements, bug fixes, Comet and Helium support",
    sections: [
      {
        items: [
          "Added tab tracking support for Comet and Helium browsers",
          "Improved disabling and enabling tab tracking",
          "Improved the speed of switching between tabs",
          "Holding down Tab to cycle now follows the system keyboard repeat settings",
          "Sped up mouse activation and added an Instant option in settings",
          "Dismissing TabTab with Escape now refocuses the previous window",
          "Fixed some apps not being tracked when they were opened",
        ],
        detail: "Known issue in this release: Firefox vertical tab support was temporarily broken.",
      },
    ],
  },
  {
    version: "2.0.2",
    title: "Hotfixes",
    sections: [
      {
        items: [
          "Fixed an incorrect tab order when non-Pro users disabled grouped tabs",
          "Improved the appearance of browser favicons",
        ],
      },
    ],
  },
  {
    version: "2.0.1",
    title: "Performance and polish",
    sections: [
      {
        heading: "New features",
        items: [
          "Browser favicons on the primary layer — Favicons now appear beside the app icon, even in search mode. Firefox is not supported due to technical limitations.",
          "Instant search by typing — Search now activates as soon as you type, including while holding Option or Command. The reserved characters W and Q are excluded.",
          "Enhanced app launcher — Added missing apps, including Finder and Keychain.",
        ],
      },
      {
        heading: "Performance improvements",
        items: [
          "Reduced the bundle size to one-sixth of the previous version",
          "Reduced CPU usage and laid the foundation for further optimisations",
        ],
        detail: "TabTab briefly checks window and tab validity. Activity Monitor can make these very short CPU spikes appear larger than they are because of its sampling interval.",
      },
      {
        heading: "Bug fixes",
        items: [
          "Window layering — TabTab now always appears above other windows, matching the macOS app switcher",
          "Firefox support restored — Tabs are tracked in Firefox and Firefox Nightly again",
          "Tab ignoring — Restored the ability to ignore tabs in apps such as Chrome and Arc",
          "Shift+Tab now cycles backward more reliably, including in search mode",
          "Improved Chrome tab switching when additional dialog boxes are present",
        ],
      },
    ],
  },
  {
    version: "2.0",
    title: "The biggest update yet",
    summary: "A free update for all users.",
    sections: [
      {
        heading: "Fresh new look",
        body: "Redesigned TabTab to better align with macOS 26, including a new icon and website.",
      },
      {
        heading: "Tabs grouped by windows",
        body: "A new layout designed to make TabTab fit more naturally into existing workflows.",
        items: [
          "Tabs are grouped by their window by default. Select the number beside a tab to see the other tabs in that window.",
          "Search shows every relevant tab, regardless of its group.",
          "Use the left and right arrows to move in and out of a grouped window.",
          "Grouping can be disabled in settings to display every tab at once.",
        ],
      },
      {
        heading: "Improved tab tracking reliability",
        items: [
          "Significantly improved tab tracking for Google Chrome, Safari, Brave, and Microsoft Edge",
          "Added Arc browser support",
          "Added browser favicons in grouped tab mode",
          "Added URL search for supported browser tabs",
        ],
      },
      {
        heading: "Other big improvements",
        items: [
          "All tabs are registered on startup, without needing to open them first",
          "TabTab now doubles as an app launcher for apps that are not registered yet",
          "Redesigned the onboarding flow",
          "Redesigned settings",
          "Added an option to increase TabTab's width",
        ],
      },
      {
        heading: "Bug fixes",
        items: [
          "Fixed the search box sometimes not receiving focus when TabTab appears",
          "Prevented Notification Center from appearing for users with a non-English system language",
          "Fixed Cmd+Q and Cmd+W not quitting apps or closing windows for some users",
          "Fixed search input that uses an IME confirmation box",
          "Many more fixes",
        ],
      },
    ],
  },
  {
    version: "1.3.4",
    title: "Stability update",
    sections: [
      {
        heading: "New features",
        items: [
          "Added advanced regular expression filters for ignoring specific apps and window or tab names",
          "Made TabTab feel snappier and more responsive",
          "Added Portuguese and Dutch language support",
        ],
      },
      {
        heading: "Bug fixes",
        items: [
          "Improved tab identification for non-English tabs",
          "Fixed a critical issue that prevented some users from switching between Chrome tabs",
          "Fixed a critical crash affecting some systems",
          "When tabs share a name, TabTab now switches to the newest tab instead of the earliest",
        ],
      },
    ],
  },
  {
    version: "1.3.3",
    title: "Stability update",
    sections: [
      {
        heading: "New features",
        items: [
          "Added advanced regular expression filters for ignoring specific apps and window or tab names",
          "Made TabTab feel snappier and more responsive",
          "Added Portuguese and Dutch language support",
        ],
      },
      {
        heading: "Bug fixes",
        items: [
          "Improved tab identification for non-English tabs",
          "Fixed a critical issue that prevented some users from switching between Chrome tabs",
          "Fixed a critical crash affecting some systems",
          "When tabs share a name, TabTab now switches to the newest tab instead of the earliest",
        ],
      },
    ],
  },
  {
    version: "1.3.2",
    title: "Settings, actions, and performance",
    sections: [
      {
        heading: "Highlights",
        items: [
          "Added right-click actions for tabs, including adding apps to the ignore list",
          "Completely revamped the app settings page",
          "Improved performance, with smoother operation and faster app switching",
        ],
      },
      {
        heading: "New features",
        items: [
          "Added an option to disable the default Option+Tab and Command+Tab hotkeys and use only quick search",
          "Added Cmd+W to close individual windows",
          "Added the ability to ignore specific apps when mouse activation is enabled",
        ],
      },
      {
        heading: "Bug fixes",
        items: [
          "Fixed interference from Chrome's Find in Page window",
          "Fixed Safari not closing properly with Cmd+Q",
          "Fixed various crashes",
          "Fixed issues affecting non-English users",
        ],
      },
      {
        heading: "Improvements",
        items: [
          "Enhanced mouse activation sensitivity",
          "Added support for searching English app names on non-English systems",
        ],
      },
    ],
  },
  { version: "1.3.1", sections: [] },
  {
    version: "1.3",
    title: "Window titles, focus, and navigation",
    sections: [
      {
        heading: "New features",
        items: [
          "Multiline window titles — Added a setting to make titles multiline by hiding the app name",
          "Improved focus behaviour so keyboard focus consistently follows window switches",
          "Updated cursor hover behaviour to match the macOS app switcher",
          "Changed the default quick-search shortcut to Cmd+Shift+K to reduce conflicts",
          "Added an option to disable quick search completely",
          "Added animations when reaching scroll limits",
          "Added backward navigation using the backtick key above Tab",
        ],
      },
      {
        heading: "Bug fixes",
        items: [
          "Resolved Safari full-screen tab tracking issues",
          "Improved Traditional Chinese language support",
          "Improved window switching across different desktops",
          "Various stability improvements and bug fixes",
        ],
      },
    ],
  },
  {
    version: "1.2",
    title: "Quick search, app filtering, and more browsers",
    sections: [
      {
        heading: "New features",
        items: [
          "Customizable Tab Bar position — Choose the left, center, or right side of the screen",
          "Quick Search mode — Open Tab Bar with search active using a custom shortcut, defaulting to Cmd+K",
          "Added tab support for Notion, Brave Browser, and Microsoft Edge",
          "Added more reliable app filtering",
          "Added Cmd+Q to quit an app while hovering over one of its tabs",
          "Expanded support for French, German, Korean, Spanish, Arabic, and Chinese (Hong Kong)",
        ],
      },
      {
        heading: "Bug fixes",
        items: [
          "Cosmetic improvements to the Tab Bar",
          "Fixed windows occasionally disappearing unexpectedly",
          "Fixed the Tab Bar sometimes not responding to hotkey activation",
          "Stability improvements and minor bug fixes",
        ],
      },
    ],
  },
  {
    version: "1.1.2",
    title: "Bug fixes and improvements",
    sections: [
      {
        items: [
          "Fixed a critical issue where Tab Bar would sometimes fail to appear or disappear",
          "Enhanced support for handling multiple windows",
          "Various minor bug fixes and stability improvements",
        ],
      },
    ],
  },
  {
    version: "1.1.1",
    title: "Bug fixes and improvements",
    sections: [
      {
        items: [
          "Fixed a critical issue where Tab Bar would sometimes fail to appear",
          "Enhanced support for handling multiple windows",
          "Various minor bug fixes and stability improvements",
        ],
      },
    ],
  },
  {
    version: "1.1",
    title: "Speed, stability, and tab tracking",
    sections: [
      {
        heading: "Major updates",
        items: [
          "Significantly improved Tab Bar speed and stability, including with a large number of tabs",
          "Made Tab Bar presentation animations more fluid and responsive",
        ],
      },
      {
        heading: "Bug fixes",
        items: ["Resolved tab tracking issues with Chrome and Safari"],
      },
      {
        heading: "New features",
        items: [
          "Improved tab tracking for Chinese, Traditional Chinese, Polish, and Japanese",
          "Added tab tracking compatibility with beta versions of Chrome, Firefox, and VS Code",
        ],
      },
      {
        heading: "Refinements",
        items: ["Numerous interface improvements for a more polished experience"],
      },
    ],
  },
  {
    version: "1.0.9",
    title: "Critical fix",
    sections: [
      {
        items: ["Fixed a critical bug with tab tracking"],
      },
    ],
  },
  {
    version: "1.0.8",
    title: "Tab tracking and customization improvements",
    sections: [
      {
        items: [
          "Improved tab tracking for non-English system languages",
          "Added settings to ignore tab tracking in supported apps, including a complete windows-only mode",
          "Added an option to hide the menu bar icon",
          "Made Chrome tab display cleaner",
          "Holding Tab while Tab Bar is open now automatically cycles through tabs",
          "Added stability fixes for tab tracking",
          "Updated the Discord invite link in settings",
        ],
      },
    ],
  },
  { version: "1.0.7", sections: [] },
  { version: "1.0.6", sections: [] },
  { version: "1.0.5", sections: [] },
  { version: "1.0.4", sections: [] },
  { version: "1.0.2", sections: [] },
  { version: "1.0.1", sections: [] },
  { version: "1.0", sections: [] },
];
