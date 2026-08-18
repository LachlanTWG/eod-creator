export const THEME_KEY = "tsd-theme";

export const THEME_BOOT = `(function(){try{var t=localStorage.getItem("${THEME_KEY}");var q=new URLSearchParams(location.search).get("theme");if(q==="dark"||q==="light")t=q;if(t!=="dark"&&t!=="light")t="light";var r=document.documentElement;r.classList.toggle("dark",t==="dark");r.style.colorScheme=t;}catch(e){}})();`;
