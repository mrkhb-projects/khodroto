/**
 * Tamas Box - frontend behaviour (multi box)
 *
 * Every .tmb-root is an independent widget with its own button and panel.
 * Desktop: the panel slides from the button side.
 * Mobile : every box becomes a bottom sheet with swipe-to-dismiss.
 */
( function () {
	'use strict';

	var cfg = window.TMB_DATA || {};
	var STORAGE_KEY = 'tmb_dismissed';

	/**
	 * wp_localize_script() always casts every value to a string before
	 * printing it into the page, so PHP's (int) 0 / 1 become the JS
	 * strings "0" / "1". The string "0" is truthy in JavaScript, so a
	 * plain `if ( cfg.openOnLoad )` check was always true - even when the
	 * admin turned "باز شدن خودکار" off. This helper normalises those
	 * localized "0"/"1" (or real booleans/numbers) into real booleans.
	 */
	function flag( value ) {
		return '1' === value || 1 === value || true === value;
	}

	function ready( fn ) {
		if ( document.readyState !== 'loading' ) {
			fn();
		} else {
			document.addEventListener( 'DOMContentLoaded', fn );
		}
	}

	function isMobile() {
		return window.matchMedia( '(max-width: 768px)' ).matches;
	}

	ready( function () {
		var roots = Array.prototype.slice.call( document.querySelectorAll( '.tmb-root:not(.tmb-inline)' ) );
		if ( ! roots.length ) {
			return;
		}

		var widgets = [];

		/* ------------------------------------------------------
		   Stack boxes that share the same position
		   ------------------------------------------------------ */
		( function stackBoxes() {
			var groups = {};
			roots.forEach( function ( root ) {
				var pos = ( root.className.match( /tmb-pos-([a-z-]+)/ ) || [] )[ 1 ] || 'bottom-right';
				groups[ pos ] = groups[ pos ] || [];
				root.setAttribute( 'data-tmb-stack', String( groups[ pos ].length ) );
				groups[ pos ].push( root );
			} );
		} )();

		function Widget( root ) {
			var self = this;

			this.root    = root;
			this.id      = root.getAttribute( 'data-tmb-box' ) || '';
			this.btn     = root.querySelector( '.tmb-btn' );
			this.panel   = root.querySelector( '.tmb-panel' );
			this.overlay = root.querySelector( '[data-tmb-overlay]' );
			this.isOpen  = false;

			if ( ! this.btn || ! this.panel ) {
				return;
			}

			/* :has() fallback */
			try {
				if ( ! CSS.supports( 'selector(:has(*))' ) && this.btn.querySelector( '.tmb-btn-text' ) ) {
					this.btn.classList.add( 'tmb-has-label' );
				}
			} catch ( e ) {
				if ( this.btn.querySelector( '.tmb-btn-text' ) ) {
					this.btn.classList.add( 'tmb-has-label' );
				}
			}

			this.btn.addEventListener( 'click', function ( e ) {
				e.preventDefault();
				e.stopPropagation();
				self.toggle();
			} );

			if ( this.overlay ) {
				this.overlay.addEventListener( 'click', function () {
					self.close( true );
				} );
			}

			root.querySelectorAll( '.tmb-close, .tmb-head-close' ).forEach( function ( el ) {
				el.addEventListener( 'click', function ( e ) {
					e.preventDefault();
					self.close( true );
				} );
			} );

			/* close the sheet shortly after a contact link is used */
			root.querySelectorAll( '.tmb-item' ).forEach( function ( item ) {
				item.addEventListener( 'click', function () {
					window.setTimeout( function () {
						self.close( false );
					}, 220 );
				} );
			} );

			this.initDrag();
		}

		Widget.prototype.lockScroll = function ( lock ) {
			if ( ! isMobile() ) {
				return;
			}
			document.body.classList.toggle( 'tmb-locked', !! lock );
		};

		Widget.prototype.open = function () {
			if ( this.isOpen ) {
				return;
			}

			/* only one box open at a time */
			widgets.forEach( function ( w ) {
				if ( w !== this && w.isOpen ) {
					w.close( false );
				}
			}, this );

			this.isOpen  = true;
			this.panel.hidden = false;
			if ( this.overlay ) {
				this.overlay.hidden = false;
			}

			void this.panel.offsetWidth; // reflow

			this.root.classList.add( 'is-open' );
			this.btn.setAttribute( 'aria-expanded', 'true' );
			this.lockScroll( true );

			var first = this.panel.querySelector( '.tmb-item, .tmb-close' );
			if ( first ) {
				window.setTimeout( function () {
					first.focus( { preventScroll: true } );
				}, 320 );
			}

			document.dispatchEvent( new CustomEvent( 'tmb:open', { detail: { id: this.id } } ) );
		};

		Widget.prototype.close = function ( remember ) {
			if ( ! this.isOpen ) {
				return;
			}
			var self = this;

			this.isOpen = false;
			this.root.classList.remove( 'is-open', 'is-dragging' );
			this.panel.style.transform = '';
			this.btn.setAttribute( 'aria-expanded', 'false' );
			this.lockScroll( false );

			window.setTimeout( function () {
				if ( ! self.isOpen ) {
					self.panel.hidden = true;
					if ( self.overlay ) {
						self.overlay.hidden = true;
					}
				}
			}, 360 );

			if ( remember && flag( cfg.remember ) ) {
				try {
					window.localStorage.setItem( STORAGE_KEY + '_' + this.id, '1' );
				} catch ( e ) {}
			}

			document.dispatchEvent( new CustomEvent( 'tmb:close', { detail: { id: this.id } } ) );
		};

		Widget.prototype.toggle = function () {
			if ( this.isOpen ) {
				this.close( true );
			} else {
				this.open();
			}
		};

		/* swipe down to dismiss on mobile */
		Widget.prototype.initDrag = function () {
			var self     = this;
			var startY   = 0;
			var currentY = 0;
			var dragging = false;
			var height   = 0;

			function dragStart( e ) {
				if ( ! self.isOpen || ! isMobile() ) {
					return;
				}
				var itemsBox   = self.panel.querySelector( '.tmb-items' );
				var fromHandle = e.target.closest( '.tmb-handle, .tmb-head' );

				if ( ! fromHandle && itemsBox && itemsBox.scrollTop > 0 ) {
					return;
				}

				startY   = e.touches ? e.touches[ 0 ].clientY : e.clientY;
				currentY = startY;
				height   = self.panel.offsetHeight;
				dragging = true;
				self.root.classList.add( 'is-dragging' );
			}

			function dragMove( e ) {
				if ( ! dragging ) {
					return;
				}
				currentY  = e.touches ? e.touches[ 0 ].clientY : e.clientY;
				var delta = currentY - startY;

				if ( delta < 0 ) {
					delta = delta / 6;
				}
				self.panel.style.transform = 'translateY(' + delta + 'px)';
			}

			function dragEnd() {
				if ( ! dragging ) {
					return;
				}
				dragging = false;
				self.root.classList.remove( 'is-dragging' );

				var delta = currentY - startY;
				self.panel.style.transform = '';

				if ( delta > Math.min( 120, height * 0.28 ) ) {
					self.close( true );
				}
			}

			this.panel.addEventListener( 'touchstart', dragStart, { passive: true } );
			this.panel.addEventListener( 'touchmove', dragMove, { passive: true } );
			this.panel.addEventListener( 'touchend', dragEnd );
			this.panel.addEventListener( 'touchcancel', dragEnd );
		};

		/* ------------------------------------------------------
		   Boot
		   ------------------------------------------------------ */
		roots.forEach( function ( root ) {
			var w = new Widget( root );
			if ( w.btn && w.panel ) {
				widgets.push( w );
			}
		} );

		function byId( id ) {
			if ( ! id ) {
				return widgets[ 0 ];
			}
			for ( var i = 0; i < widgets.length; i++ ) {
				if ( widgets[ i ].id === id ) {
					return widgets[ i ];
				}
			}
			return widgets[ 0 ];
		}

		/* inline shortcode buttons */
		document.querySelectorAll( '[data-tmb-open]' ).forEach( function ( el ) {
			el.addEventListener( 'click', function ( e ) {
				e.preventDefault();
				var w = byId( el.getAttribute( 'data-tmb-open' ) );
				if ( w ) {
					w.open();
				}
			} );
		} );

		/* esc closes whatever is open */
		document.addEventListener( 'keydown', function ( e ) {
			if ( 'Escape' !== e.key ) {
				return;
			}
			widgets.forEach( function ( w ) {
				if ( w.isOpen ) {
					w.close( true );
					w.btn.focus();
				}
			} );
		} );

		/* click outside (desktop) */
		document.addEventListener( 'click', function ( e ) {
			if ( isMobile() ) {
				return;
			}
			widgets.forEach( function ( w ) {
				if ( ! w.isOpen ) {
					return;
				}
				if ( w.panel.contains( e.target ) || w.btn.contains( e.target ) ) {
					return;
				}
				if ( e.target.closest && e.target.closest( '[data-tmb-open]' ) ) {
					return;
				}
				w.close( true );
			} );
		} );

		/* close on scroll */
		if ( flag( cfg.closeOnScroll ) ) {
			var lastY = window.pageYOffset;
			window.addEventListener(
				'scroll',
				function () {
					if ( Math.abs( window.pageYOffset - lastY ) > 120 ) {
						widgets.forEach( function ( w ) {
							if ( w.isOpen ) {
								w.close( false );
							}
						} );
					}
					lastY = window.pageYOffset;
				},
				{ passive: true }
			);
		}

		/* auto open the first visible box */
		if ( flag( cfg.openOnLoad ) && widgets.length ) {
			var target    = widgets[ 0 ];
			var dismissed = false;
			try {
				dismissed = flag( cfg.remember ) && '1' === window.localStorage.getItem( STORAGE_KEY + '_' + target.id );
			} catch ( e ) {}

			if ( ! dismissed ) {
				window.setTimeout( function () {
					target.open();
				}, Math.max( 0, parseInt( cfg.openDelay, 10 ) || 0 ) * 1000 );
			}
		}

		/* keep the scroll lock sane across breakpoints */
		window.addEventListener( 'resize', function () {
			var anyOpen = widgets.some( function ( w ) {
				return w.isOpen;
			} );
			if ( ! isMobile() || ! anyOpen ) {
				document.body.classList.remove( 'tmb-locked' );
			} else {
				document.body.classList.add( 'tmb-locked' );
			}
		} );

		/* public API */
		window.TamasBox = {
			open: function ( id ) {
				var w = byId( id );
				if ( w ) {
					w.open();
				}
			},
			close: function ( id ) {
				if ( undefined === id ) {
					widgets.forEach( function ( w ) {
						w.close( false );
					} );
					return;
				}
				var w = byId( id );
				if ( w ) {
					w.close( false );
				}
			},
			toggle: function ( id ) {
				var w = byId( id );
				if ( w ) {
					w.toggle();
				}
			},
			isOpen: function ( id ) {
				var w = byId( id );
				return w ? w.isOpen : false;
			},
			boxes: function () {
				return widgets.map( function ( w ) {
					return w.id;
				} );
			}
		};
	} );
} )();
