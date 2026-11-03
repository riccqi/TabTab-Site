export const sourceIcons = {
  x: { src: "/symbols/x-twitter.svg", label: "X (Twitter)" },
  youtube: { src: "/symbols/youtube.svg", label: "YouTube" },
  producthunt: { src: "/symbols/producthunt.svg", label: "Product Hunt" },
};

export type Review = {
  quote: string;
  name: string;
  href?: string;
  avatar?: string;
  source?: keyof typeof sourceIcons;
};

export const reviews: Review[] = [
  {
    quote: "This is a fantastic product, this is how Apple should have built the tab navigation!",
    name: "Pablo Sanzo",
    href: "https://www.linkedin.com/in/pablosanzo/",
  },
  {
    quote: "I really think this is a great app, it's been well built. I think it's a good replacement for the default Mac experience.",
    name: "Robin Bilgil",
    avatar: "/avatars/robin-bilgil.jpg",
    href: "https://www.youtube.com/watch?v=1mHopTxGLNw",
    source: "youtube",
  },
  {
    quote: "A big fan of anything that makes my Mac more fun and useful to use - TabTab does exactly that. I find it really useful when I have a ton of Cursor tab/files open and I'm referring to documentation on a browser.",
    name: "Gabe Perez",
    avatar: "/avatars/gabe-perez.jpg",
    href: "https://www.producthunt.com/@gabe",
    source: "producthunt",
  },
  {
    quote: "我用几个月了，这玩意tm好用炸了，推荐所有人下载！",
    name: "Megabits",
    avatar: "/avatars/megabits.jpg",
    href: "https://x.com/Megabits_mzq/status/1859111667294236854",
    source: "x",
  },
  {
    quote: "This product is very underrated, I think. It works better than other window switchers I tried, like Alttab. Design is so beautiful, and details are very polished.",
    name: "Sakamoto",
    avatar: "/avatars/sakamoto.jpg",
    href: "https://www.producthunt.com/products/tabtab-2/reviews",
    source: "producthunt",
  },
  {
    quote: "I've been using TabTab for over a month, and it works great. It's snappy and doesn't get in the way when I'm working. Richard updates TabTab regularly and actively listens to user feedback.",
    name: "Andre",
    href: "https://x.com/aelew_/status/1859670424331878902",
    source: "x",
  },
  {
    quote: "TabTab is my latest favorite app 💛",
    name: "Hieu Dinh",
    avatar: "/avatars/hieu-dinh.jpg",
    href: "https://x.com/hieudinh_/status/1860697475754922452",
    source: "x",
  },
  {
    quote: "Every now and then a utility comes around that you didn't know you needed.",
    name: "ScreenCastsONLINE",
    avatar: "/avatars/screencastsonline.jpg",
    href: "https://www.youtube.com/watch?v=w_Bk-eMUils",
    source: "youtube",
  },
  {
    quote: "Been using TabTab for my window management the past week. Really like how it lets me search through tabs while I'm context switching between projects. Simple but gets the job done!",
    name: "Naveen Naidu",
    avatar: "/avatars/naveen-naidu.jpg",
    href: "https://x.com/naveennaidu_m/status/1860717396014907408",
    source: "x",
  },
  {
    quote: "TabTab is fast and lets you navigate through individual tabs with a standard hotkey.",
    name: "Neil Chudleigh",
    avatar: "/avatars/neil-chudleigh.jpg",
    href: "https://x.com/neilsuperduper",
    source: "x",
  },
  {
    quote: "I tested it and was sold in minutes, just got myself a licence. macOs really needs a better window switcher, and this one is the best I've tried.",
    name: "Marcel Cruz",
    avatar: "/avatars/marcel-cruz.jpg",
    href: "https://www.producthunt.com/posts/tabtab-2",
    source: "producthunt",
  },
  {
    quote: "一言で言えば ⌘ + tab の進化系、あるいは Stage ManagerとMission Controlの互換機能。特に一画面でマルチタスクをする人にお勧めしたい。",
    name: "nyanyo🧊",
    avatar: "/avatars/nyanyo.jpg",
    href: "https://x.com/nyanyo_oy/status/1863983187648770259",
    source: "x",
  },
  {
    quote: "I'm so glad I paid for TabTab. This is smooth, visually pleasing, developer is more than reactive and listens to suggestions.",
    name: "Eden",
  },
  {
    quote: "Amazing app. AltTab App didn't work well for me, but this is almost perfect.",
    name: "Jeffrey Zang",
    avatar: "/avatars/jeffrey-zang.jpg",
    href: "https://www.producthunt.com/products/tabtab-2/reviews",
    source: "producthunt",
  },
];
