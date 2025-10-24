// This runs before the page renders to prevent flash of unstyled content
(function() {
	const getInitialTheme = () => {
		if (typeof localStorage !== 'undefined') {
			const savedTheme = localStorage.getItem('theme');
			if (savedTheme) return savedTheme;
		}
		
		// Check system preference
		if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
			return 'light';
		}
		
		return 'dark';
	};

	const theme = getInitialTheme();
	if (theme === 'light') {
		document.documentElement.setAttribute('data-theme', 'light');
	}
})();

