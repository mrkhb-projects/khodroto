/**
 * Tamas Box - live chat widget.
 *
 * Vanilla JS, no jQuery. Everything it needs comes from window.TMB_CHAT
 * (printed by TMB_Chat::frontend_config). wp_localize_script turns every
 * scalar into a string, so numbers and booleans are normalised here.
 *
 * Public API:
 *   TamasBoxChat.open() / close() / toggle() / isOpen() / send(text) / unread()
 * Events on document: tmbc:open, tmbc:close, tmbc:message, tmbc:unread
 */
/*
 * Find the widget configuration, in the order we prefer:
 *
 *   1. window.TMB_CHAT   - what wp_localize_script prints (the normal case)
 *   2. data-tmbc-config  - the very same json, printed on the widget element
 *                          itself. Survives js optimisers and page caches that
 *                          move, defer or drop inline scripts.
 *   3. data-tmbc-rest    - just the endpoint
 *   4. <origin>/wp-json/tmb/v1/chat - the standard WordPress REST path
 *
 * Without one of these the widget used to quit silently, which left a chat
 * button that only changed the url to #tmb-chat. That must never happen again.
 */
function tmbChatPickConfig() {
	var cfg = window.TMB_CHAT;

	if ( cfg && cfg.rest ) {
		return cfg;
	}

	var root = document.getElementById( 'tmbc-root' );

	if ( root ) {
		var json = root.getAttribute( 'data-tmbc-config' );

		if ( json ) {
			try {
				var parsed = JSON.parse( json );

				if ( parsed && parsed.rest ) {
					return parsed;
				}
			} catch ( err ) { /* fall through */ }
		}

		var rest = root.getAttribute( 'data-tmbc-rest' );

		if ( rest ) {
			return {
				rest:     rest,
				nonce:    root.getAttribute( 'data-tmbc-nonce' ) || '',
				page:     window.location.href,
				home:     window.location.origin + '/',
				enabled:  '1',
				online:   '1',
				launcher: 'item',
				poll:     '5',
				pollClosed: '60',
				maxLength: '1000',
				title:    'چت آنلاین'
			};
		}
	}

	if ( window.location && window.location.origin ) {
		return {
			rest:     window.location.origin + '/wp-json/tmb/v1/chat',
			enabled:  '1',
			online:   '1',
			launcher: 'item',
			poll:     '5',
			pollClosed: '60',
			maxLength: '1000',
			title:    'چت آنلاین'
		};
	}

	return null;
}

/**
 * Never leave a chat button that does nothing.
 *
 * While (or if) the widget cannot start, clicks on the chat items are still
 * caught so the browser does not jump to #tmb-chat, and the reason is written
 * to the console.
 *
 * @param {string}  reason    Why we are in this state.
 * @param {boolean} temporary Still retrying - stay quiet for the visitor.
 */
function tmbChatGuard( reason, temporary ) {
	if ( document.body && ! document.body.hasAttribute( 'data-tmbc-state' ) ) {
		document.body.setAttribute( 'data-tmbc-state', 'blocked-' + reason );
	}

	window.addEventListener( 'click', function ( e ) {
		var node = e.target;

		while ( node && node !== document ) {
			if ( node.getAttribute ) {
				var action = node.getAttribute( 'data-tmb-action' );
				var href   = node.getAttribute( 'href' );

				if ( 'chat' === action || '#tmb-chat' === href || node.hasAttribute( 'data-tmbc-open' ) ) {
					/* the real widget took over - let it do its job */
					if ( window.TamasBoxChat ) {
						return;
					}

					e.preventDefault();
					e.stopPropagation();

					if ( window.console && window.console.error ) {
						window.console.error( '[Tamas Box Chat] چت باز نشد (' + reason + ')' +
							( window.TMB_CHAT_ERROR ? ' — ' + window.TMB_CHAT_ERROR : '' ) );
					}

					if ( ! temporary ) {
						tmbChatNotice();
					}
					return;
				}
			}

			node = node.parentNode;
		}
	}, true );
}

/**
 * Small visible hint so the visitor is not left guessing.
 */
function tmbChatNotice() {
	if ( document.getElementById( 'tmbc-fallback' ) ) {
		return;
	}

	var box = document.createElement( 'div' );

	box.id = 'tmbc-fallback';
	box.setAttribute( 'dir', 'rtl' );
	box.style.cssText = 'position:fixed;right:16px;bottom:16px;max-width:320px;z-index:2147483000;' +
		'background:#111827;color:#fff;padding:14px 16px;border-radius:12px;font:14px/1.9 Tahoma,sans-serif;' +
		'box-shadow:0 10px 30px rgba(0,0,0,.3)';
	box.innerHTML = '<strong>چت آنلاین بارگذاری نشد</strong><br>' +
		'احتمالاً یک افزونه کش یا بهینه‌ساز جاوااسکریپت، تنظیمات چت را از صفحه حذف کرده است.' +
		'<br>لطفاً صفحه را با Ctrl+Shift+R تازه کنید.';

	box.addEventListener( 'click', function () {
		if ( box.parentNode ) {
			box.parentNode.removeChild( box );
		}
	} );

	if ( document.body ) {
		document.body.appendChild( box );
	}
}

function tmbChatBoot( RAW ) {
	'use strict';

	/* ------------------------------------------------------------------
	 * helpers
	 * ---------------------------------------------------------------- */

	function num( value, fallback ) {
		var n = parseInt( value, 10 );
		return isNaN( n ) ? fallback : n;
	}

	function flag( value ) {
		return value === true || value === 1 || value === '1';
	}

	function txt( value, fallback ) {
		return ( value === undefined || value === null || value === '' ) ? fallback : String( value );
	}

	function pad( n ) {
		return ( n < 10 ? '0' : '' ) + n;
	}

	var C = {
		rest:        String( RAW.rest ).replace( /\/$/, '' ),
		nonce:       txt( RAW.nonce, '' ),
		page:        txt( RAW.page, '' ),
		home:        txt( RAW.home, '' ),
		loggedIn:    flag( RAW.loggedIn ),
		userName:    txt( RAW.userName, '' ),
		online:      flag( RAW.online ),

		launcher:    txt( RAW.launcher, 'item' ),
		badge:       flag( RAW.badge ),
		sound:       flag( RAW.sound ),
		autoOpen:    flag( RAW.autoOpen ),
		autoDelay:   num( RAW.autoDelay, 8 ),
		poll:        Math.max( 2, num( RAW.poll, 5 ) ) * 1000,
		pollClosed:  Math.max( 10, num( RAW.pollClosed, 60 ) ) * 1000,
		maxLength:   num( RAW.maxLength, 1000 ),
		allowNew:    flag( RAW.allowNew ),
		poweredBy:   flag( RAW.poweredBy ),

		title:       txt( RAW.title, '' ),
		greeting:    txt( RAW.greeting, '' ),
		placeholder: txt( RAW.placeholder, '' ),
		agentLabel:  txt( RAW.agentLabel, 'پشتیبانی' ),
		visitorLabel:txt( RAW.visitorLabel, 'شما' ),
		onlineText:  txt( RAW.onlineText, '' ),
		offlineText: txt( RAW.offlineText, '' ),
		offlineNote: txt( RAW.offlineNote, '' ),
		closedNote:  txt( RAW.closedNote, '' ),
		rateNote:    txt( RAW.rateNote, '' ),

		prechat:     RAW.prechat || {},
		i18n:        RAW.i18n || {}
	};

	function t( key, fallback ) {
		return txt( C.i18n[ key ], fallback );
	}

	/* localStorage may throw in private mode */
	var store = {
		get: function ( key ) {
			try {
				return window.localStorage.getItem( key ) || '';
			} catch ( e ) {
				return '';
			}
		},
		set: function ( key, value ) {
			try {
				window.localStorage.setItem( key, value );
			} catch ( e ) {}
		},
		del: function ( key ) {
			try {
				window.localStorage.removeItem( key );
			} catch ( e ) {}
		}
	};

	var TOKEN_KEY = 'tmb_chat_token';
	var NAME_KEY  = 'tmb_chat_name';
	var SEEN_KEY  = 'tmb_chat_seen';
	var OPEN_KEY  = 'tmb_chat_autoopened';

	/* Persian date/time */
	var timeFmt = null;
	var dayFmt  = null;

	try {
		if ( window.Intl && window.Intl.DateTimeFormat ) {
			timeFmt = new window.Intl.DateTimeFormat( 'fa-IR', { hour: '2-digit', minute: '2-digit' } );
			dayFmt  = new window.Intl.DateTimeFormat( 'fa-IR', { year: 'numeric', month: 'long', day: 'numeric' } );
		}
	} catch ( e ) {
		timeFmt = null;
	}

	function fmtTime( ts ) {
		var d = new Date( num( ts, 0 ) * 1000 );

		if ( isNaN( d.getTime() ) ) {
			return '';
		}
		if ( timeFmt ) {
			try {
				return timeFmt.format( d );
			} catch ( e ) {}
		}
		return pad( d.getHours() ) + ':' + pad( d.getMinutes() );
	}

	function fmtDay( ts ) {
		var d = new Date( num( ts, 0 ) * 1000 );

		if ( isNaN( d.getTime() ) ) {
			return '';
		}
		if ( dayFmt ) {
			try {
				return dayFmt.format( d );
			} catch ( e ) {}
		}
		return d.getFullYear() + '/' + pad( d.getMonth() + 1 ) + '/' + pad( d.getDate() );
	}

	function emit( name, detail ) {
		try {
			document.dispatchEvent( new window.CustomEvent( name, { detail: detail || {}, bubbles: true } ) );
		} catch ( e ) {
			var ev = document.createEvent( 'CustomEvent' );
			ev.initCustomEvent( name, true, false, detail || {} );
			document.dispatchEvent( ev );
		}
	}

	/* ------------------------------------------------------------------
	 * dom
	 * ---------------------------------------------------------------- */

	var root = document.getElementById( 'tmbc-root' );

	if ( ! root ) {
		/*
		 * The script is loaded but the window itself was never printed. Say so
		 * loudly in the console and let the caller put the guard in place, so a
		 * chat item on the page still explains itself instead of doing nothing.
		 */
		if ( window.console && window.console.warn ) {
			window.console.warn( '[Tamas Box Chat] #tmbc-root پیدا نشد: ماژول چت خاموش است یا قالب سایت wp_footer() را صدا نمی‌زند.' );
		}
		return false;
	}

	var el = {
		overlay:  root.querySelector( '[data-tmbc-overlay]' ),
		panel:    root.querySelector( '#tmbc-panel' ),
		status:   root.querySelector( '[data-tmbc-status]' ),
		statusTx: root.querySelector( '[data-tmbc-status-text]' ),
		newBtn:   root.querySelector( '[data-tmbc-new]' ),
		closeBtn: root.querySelector( '[data-tmbc-close]' ),
		body:     root.querySelector( '[data-tmbc-body]' ),
		empty:    root.querySelector( '[data-tmbc-empty]' ),
		list:     root.querySelector( '[data-tmbc-messages]' ),
		typing:   root.querySelector( '[data-tmbc-typing]' ),
		prechat:  root.querySelector( '[data-tmbc-prechat]' ),
		skip:     root.querySelector( '[data-tmbc-skip]' ),
		composer: root.querySelector( '[data-tmbc-composer]' ),
		input:    root.querySelector( '[data-tmbc-input]' ),
		send:     root.querySelector( '[data-tmbc-send]' ),
		toggle:   root.querySelector( '[data-tmbc-toggle]' ),
		badge:    root.querySelector( '[data-tmbc-badge]' )
	};

	/* ------------------------------------------------------------------
	 * state
	 * ---------------------------------------------------------------- */

	var state = {
		token:     store.get( TOKEN_KEY ),
		session:   null,
		lastId:    0,
		open:      false,
		ready:     false,
		loading:   false,
		unread:    0,
		pending:   0,
		prechatDone: false,
		queued:    '',
		lastDay:   '',
		timer:     null,
		typing:    null,
		soundCtx:  null,
		autoTimer: null
	};

	/* ------------------------------------------------------------------
	 * network
	 * ---------------------------------------------------------------- */

	function request( path, data, method ) {
		return new window.Promise( function ( resolve, reject ) {
			var xhr  = new window.XMLHttpRequest();
			var url  = C.rest + path;
			var verb = method || 'POST';

			xhr.open( verb, url, true );
			xhr.setRequestHeader( 'Content-Type', 'application/json' );
			xhr.setRequestHeader( 'X-Requested-With', 'XMLHttpRequest' );
			xhr.withCredentials = true;

			if ( C.nonce ) {
				xhr.setRequestHeader( 'X-WP-Nonce', C.nonce );
			}

			xhr.timeout = 30000;

			xhr.onreadystatechange = function () {
				if ( xhr.readyState !== 4 ) {
					return;
				}

				var payload = null;

				try {
					payload = JSON.parse( xhr.responseText || 'null' );
				} catch ( e ) {
					payload = null;
				}

				if ( xhr.status >= 200 && xhr.status < 300 && payload && payload.ok !== false ) {
					resolve( payload || {} );
					return;
				}

				reject( {
					status:  xhr.status,
					code:    payload && payload.code ? payload.code : 'tmb_http_' + xhr.status,
					message: payload && payload.message ? payload.message : t( 'failed', 'خطا در ارتباط با سرور.' ),
					data:    payload && payload.data ? payload.data : null
				} );
			};

			xhr.onerror = function () {
				reject( { status: 0, code: 'tmb_network', message: t( 'failed', 'خطا در ارتباط با سرور.' ) } );
			};
			xhr.ontimeout = function () {
				reject( { status: 0, code: 'tmb_timeout', message: t( 'failed', 'خطا در ارتباط با سرور.' ) } );
			};

			xhr.send( data ? JSON.stringify( data ) : null );
		} );
	}

	function buildQuery( params ) {
		var parts = [];

		for ( var key in params ) {
			if ( Object.prototype.hasOwnProperty.call( params, key ) && params[ key ] !== null && params[ key ] !== undefined ) {
				parts.push( encodeURIComponent( key ) + '=' + encodeURIComponent( params[ key ] ) );
			}
		}

		return parts.length ? ( '?' + parts.join( '&' ) ) : '';
	}

	/* ------------------------------------------------------------------
	 * rendering
	 * ---------------------------------------------------------------- */

	function linkify( text ) {
		var frag  = document.createDocumentFragment();
		var regex = /(https?:\/\/[^\s<>"]+)/g;
		var last  = 0;
		var match;

		while ( null !== ( match = regex.exec( text ) ) ) {
			if ( match.index > last ) {
				frag.appendChild( document.createTextNode( text.slice( last, match.index ) ) );
			}

			var a = document.createElement( 'a' );
			a.href = match[ 1 ];
			a.target = '_blank';
			a.rel = 'noopener noreferrer';
			a.textContent = match[ 1 ].length > 42 ? match[ 1 ].slice( 0, 40 ) + '…' : match[ 1 ];
			frag.appendChild( a );

			last = match.index + match[ 1 ].length;
		}

		if ( last < text.length ) {
			frag.appendChild( document.createTextNode( text.slice( last ) ) );
		}

		return frag;
	}

	function attachmentNode( att ) {
		if ( ! att || ! att.url ) {
			return null;
		}

		var wrap = document.createElement( 'div' );
		wrap.className = 'tmbc-att';

		var type = String( att.type || 'file' );
		var name = String( att.name || '' );

		if ( 'photo' === type || 'sticker' === type || 'gif' === type ) {
			var img = document.createElement( 'img' );
			img.src = att.url;
			img.alt = name || t( 'download', 'تصویر' );
			img.loading = 'lazy';
			wrap.appendChild( img );
			return wrap;
		}

		if ( 'voice' === type || 'audio' === type ) {
			var audio = document.createElement( 'audio' );
			audio.controls = true;
			audio.preload = 'none';
			audio.src = att.url;
			audio.className = 'tmbc-audio';
			wrap.appendChild( audio );
			return wrap;
		}

		if ( 'video' === type ) {
			var video = document.createElement( 'video' );
			video.controls = true;
			video.preload = 'none';
			video.src = att.url;
			video.className = 'tmbc-audio';
			wrap.appendChild( video );
			return wrap;
		}

		var link = document.createElement( 'a' );
		link.href = att.url;
		link.target = '_blank';
		link.rel = 'noopener noreferrer';
		link.textContent = '📎 ' + ( name || t( 'download', 'فایل' ) );
		wrap.appendChild( link );

		return wrap;
	}

	function dayDivider( ts ) {
		var label = fmtDay( ts );

		if ( ! label || label === state.lastDay ) {
			return null;
		}

		state.lastDay = label;

		var div = document.createElement( 'div' );
		div.className = 'tmbc-day';
		div.textContent = label;

		return div;
	}

	function messageNode( msg, optimistic ) {
		var sender = String( msg.sender || 'visitor' );
		var row    = document.createElement( 'div' );

		row.className = 'tmbc-msg ' + ( 'visitor' === sender ? 'tmbc-msg-me' : ( 'agent' === sender ? 'tmbc-msg-they' : 'tmbc-msg-system' ) );
		row.setAttribute( 'data-id', String( msg.id || 0 ) );

		if ( optimistic ) {
			row.className += ' tmbc-state-sending';
		}

		var bubble = document.createElement( 'div' );
		bubble.className = 'tmbc-bubble';

		if ( 'agent' === sender ) {
			var who = document.createElement( 'span' );
			who.className = 'tmbc-who';
			who.textContent = msg.agent ? String( msg.agent ) : C.agentLabel;
			bubble.appendChild( who );
		}

		var body = String( msg.body || '' );

		if ( body ) {
			var text = document.createElement( 'span' );
			text.className = 'tmbc-text';
			text.appendChild( linkify( body ) );
			bubble.appendChild( text );
		}

		var att = attachmentNode( msg.attachment );

		if ( att ) {
			bubble.appendChild( att );
		}

		if ( ! body && ! att ) {
			return null;
		}

		row.appendChild( bubble );

		var meta = document.createElement( 'div' );
		meta.className = 'tmbc-meta';

		var time = document.createElement( 'span' );
		time.className = 'tmbc-time';
		time.textContent = fmtTime( msg.ts );
		meta.appendChild( time );

		if ( 'visitor' === sender ) {
			var tick = document.createElement( 'span' );
			tick.className = 'tmbc-tick';
			tick.textContent = optimistic ? '⌛' : '✓';
			meta.appendChild( tick );
		}

		row.appendChild( meta );

		return row;
	}

	function scrollToBottom( force ) {
		if ( ! el.body ) {
			return;
		}

		var near = el.body.scrollHeight - el.body.scrollTop - el.body.clientHeight < 140;

		if ( force || near ) {
			el.body.scrollTop = el.body.scrollHeight;
		}
	}

	function syncEmpty() {
		if ( ! el.empty || ! el.list ) {
			return;
		}

		var has = el.list.children.length > 0;
		el.empty.hidden = has;
	}

	function appendMessages( messages, forceScroll ) {
		if ( ! el.list || ! messages || ! messages.length ) {
			return 0;
		}

		var added = 0;

		for ( var i = 0; i < messages.length; i++ ) {
			var msg = messages[ i ];
			var id  = num( msg.id, 0 );

			if ( id && id <= state.lastId ) {
				continue;
			}

			var divider = dayDivider( msg.ts );

			if ( divider ) {
				el.list.appendChild( divider );
			}

			var node = messageNode( msg, false );

			if ( node ) {
				el.list.appendChild( node );
				added++;
			}

			if ( id ) {
				state.lastId = id;
			}

			if ( 'agent' === msg.sender ) {
				emit( 'tmbc:message', { message: msg } );
			}
		}

		if ( added ) {
			syncEmpty();
			scrollToBottom( !! forceScroll );
		}

		return added;
	}

	function notice( text, kind ) {
		if ( ! el.list || ! text ) {
			return;
		}

		var old = el.list.querySelector( '.tmbc-notice[data-kind="' + ( kind || 'info' ) + '"]' );

		if ( old ) {
			old.parentNode.removeChild( old );
		}

		var div = document.createElement( 'div' );
		div.className = 'tmbc-notice';
		div.setAttribute( 'data-kind', kind || 'info' );
		div.textContent = text;

		el.list.appendChild( div );
		scrollToBottom( true );
	}

	function clearNotice( kind ) {
		if ( ! el.list ) {
			return;
		}

		var node = el.list.querySelector( '.tmbc-notice[data-kind="' + kind + '"]' );

		if ( node ) {
			node.parentNode.removeChild( node );
		}
	}

	/* ------------------------------------------------------------------
	 * ui state
	 * ---------------------------------------------------------------- */

	function setStatus() {
		var online = state.session && 'closed' === state.session.status ? false : C.online;

		root.classList.toggle( 'is-offline', ! C.online );

		if ( el.statusTx ) {
			el.statusTx.textContent = C.online ? C.onlineText : C.offlineText;
		}

		if ( el.input ) {
			el.input.disabled = ! state.ready || ( state.session && 'closed' === state.session.status );
		}
		if ( el.send ) {
			el.send.disabled = ! state.ready || ( state.session && 'closed' === state.session.status );
		}

		return online;
	}

	function setClosed( closed ) {
		closed = !! closed;

		root.classList.toggle( 'is-closed', closed );

		if ( el.newBtn ) {
			el.newBtn.hidden = ! ( closed && C.allowNew );
		}

		var row = el.list ? el.list.querySelector( '.tmbc-restart-row' ) : null;

		if ( ! closed ) {
			clearNotice( 'closed' );

			if ( row && row.parentNode ) {
				row.parentNode.removeChild( row );
			}

			return;
		}

		if ( C.closedNote ) {
			notice( C.closedNote, 'closed' );
		}

		if ( ! C.allowNew || ! el.list || row ) {
			return;
		}

		var restart = document.createElement( 'div' );
		restart.className = 'tmbc-prechat-actions tmbc-restart-row';

		var btn = document.createElement( 'button' );
		btn.type = 'button';
		btn.className = 'tmbc-btn-primary';
		btn.textContent = t( 'newChat', 'گفتگوی جدید' );
		btn.addEventListener( 'click', restartChat );

		restart.appendChild( btn );
		el.list.appendChild( restart );
		scrollToBottom( true );
	}

	function setUnread( count ) {
		state.unread = Math.max( 0, num( count, 0 ) );

		var badges = document.querySelectorAll( '[data-tmbc-badge],[data-tmb-chat-unread]' );

		for ( var i = 0; i < badges.length; i++ ) {
			var badge = badges[ i ];

			if ( ! C.badge || state.unread < 1 || state.open ) {
				badge.hidden = true;
				badge.textContent = '0';
			} else {
				badge.hidden = false;
				badge.textContent = state.unread > 99 ? '99+' : String( state.unread );
			}
		}

		emit( 'tmbc:unread', { count: state.unread } );
	}

	function showTyping( on ) {
		if ( ! el.typing ) {
			return;
		}

		el.typing.hidden = ! on;

		if ( on ) {
			scrollToBottom( true );
		}
	}

	function beep() {
		if ( ! C.sound ) {
			return;
		}

		try {
			var Ctx = window.AudioContext || window.webkitAudioContext;

			if ( ! Ctx ) {
				return;
			}

			if ( ! state.soundCtx ) {
				state.soundCtx = new Ctx();
			}

			var ctx  = state.soundCtx;
			var osc  = ctx.createOscillator();
			var gain = ctx.createGain();

			osc.type = 'sine';
			osc.frequency.value = 880;
			gain.gain.value = 0.0001;

			osc.connect( gain );
			gain.connect( ctx.destination );

			var now = ctx.currentTime;
			gain.gain.exponentialRampToValueAtTime( 0.08, now + 0.02 );
			gain.gain.exponentialRampToValueAtTime( 0.0001, now + 0.35 );

			osc.start( now );
			osc.stop( now + 0.36 );
		} catch ( e ) {}
	}

	/* ------------------------------------------------------------------
	 * open / close
	 * ---------------------------------------------------------------- */

	/*
	 * On phones the panel covers the screen, so the page behind must not
	 * scroll or rubber-band while it is open.
	 */
	function lockScroll( on ) {
		var html = document.documentElement;

		if ( ! html ) {
			return;
		}

		if ( on && window.matchMedia && window.matchMedia( '(max-width: 768px)' ).matches ) {
			html.classList.add( 'tmbc-lock' );
		} else {
			html.classList.remove( 'tmbc-lock' );
		}
	}

	function open( focus ) {
		if ( state.open ) {
			return;
		}

		state.open = true;

		root.classList.add( 'is-open' );
		lockScroll( true );

		if ( el.panel ) {
			el.panel.hidden = false;
		}
		if ( el.overlay ) {
			el.overlay.hidden = window.innerWidth > 768 ? true : false;
		}
		if ( el.toggle ) {
			el.toggle.setAttribute( 'aria-expanded', 'true' );
		}

		setUnread( 0 );

		if ( ! state.ready ) {
			boot();
		} else {
			pollNow( true );
		}

		if ( focus !== false && el.input ) {
			window.setTimeout( function () {
				el.input.focus();
			}, 260 );
		}

		startPolling();
		emit( 'tmbc:open', {} );
	}

	function close() {
		if ( ! state.open ) {
			return;
		}

		state.open = false;

		root.classList.remove( 'is-open' );
		lockScroll( false );

		if ( el.overlay ) {
			el.overlay.hidden = true;
		}
		if ( el.toggle ) {
			el.toggle.setAttribute( 'aria-expanded', 'false' );
		}

		window.setTimeout( function () {
			if ( ! state.open && el.panel ) {
				el.panel.hidden = true;
			}
		}, 320 );

		startPolling();
		emit( 'tmbc:close', {} );
	}

	function toggle() {
		if ( state.open ) {
			close();
		} else {
			open();
		}
	}

	/* ------------------------------------------------------------------
	 * session
	 * ---------------------------------------------------------------- */

	function applySession( payload ) {
		if ( ! payload ) {
			return;
		}

		if ( payload.token ) {
			state.token = String( payload.token );
			store.set( TOKEN_KEY, state.token );
		}

		if ( payload.session ) {
			state.session = payload.session;
		}

		if ( payload.config && typeof payload.config.online !== 'undefined' ) {
			C.online = flag( payload.config.online );
		}

		if ( typeof payload.online !== 'undefined' ) {
			C.online = flag( payload.online );
		}

		state.ready = !! state.session;

		root.classList.add( 'tmbc-ready' );

		setStatus();
		setClosed( !!( state.session && 'closed' === state.session.status ) );

		if ( state.session ) {
			setUnread( state.open ? 0 : num( state.session.unread, 0 ) );
		}
	}

	function boot() {
		if ( state.loading ) {
			return;
		}

		state.loading = true;

		var data = {
			token: state.token,
			page:  C.page || window.location.href
		};

		var savedName = store.get( NAME_KEY );

		if ( savedName ) {
			data.name = savedName;
		}
		if ( C.userName ) {
			data.name = C.userName;
		}

		request( '/session', data, 'POST' )
			.then( function ( payload ) {
				state.loading = false;

				applySession( payload );

				if ( el.list ) {
					el.list.innerHTML = '';
					state.lastId = 0;
					state.lastDay = '';
				}

				appendMessages( payload.messages, true );

				if ( ! C.online && C.offlineNote ) {
					notice( C.offlineNote, 'offline' );
				}

				maybePrechat();
				startPolling();

				if ( state.open && el.input ) {
					el.input.focus();
				}

				if ( state.queued ) {
					var pending = state.queued;
					state.queued = '';
					send( pending );
				}
			} )
			.catch( function ( err ) {
				state.loading = false;

				if ( 'tmb_no_session' === err.code || 404 === err.status ) {
					store.del( TOKEN_KEY );
					state.token = '';
					boot();
					return;
				}

				if ( 429 === err.status ) {
					notice( err.message || C.rateNote, 'error' );
					return;
				}

				notice( err.message || t( 'failed', 'خطا در ارتباط با سرور.' ), 'error' );
				window.setTimeout( boot, 8000 );
			} );
	}

	function maybePrechat() {
		var pc = C.prechat || {};

		state.prechatDone = true;

		if ( ! flag( pc.enabled ) || ! el.prechat ) {
			if ( el.prechat ) {
				el.prechat.hidden = true;
			}
			return;
		}

		var hasName = !!( state.session && state.session.name );

		if ( hasName || store.get( NAME_KEY ) ) {
			el.prechat.hidden = true;
			return;
		}

		state.prechatDone = false;

		el.prechat.hidden = false;

		var nameInput = el.prechat.querySelector( 'input[name="name"]' );

		if ( nameInput && C.userName ) {
			nameInput.value = C.userName;
		}
	}

	function submitPrechat( skip ) {
		if ( ! el.prechat ) {
			return;
		}

		var nameInput    = el.prechat.querySelector( 'input[name="name"]' );
		var contactInput = el.prechat.querySelector( 'input[name="contact"]' );
		var name         = nameInput ? String( nameInput.value || '' ).trim() : '';
		var contact      = contactInput ? String( contactInput.value || '' ).trim() : '';
		var pc           = C.prechat || {};

		if ( ! skip && flag( pc.required ) ) {
			var missing = false;

			if ( flag( pc.name ) && ! name ) {
				missing = true;
				if ( nameInput ) {
					nameInput.focus();
				}
			}
			if ( ! missing && flag( pc.phone ) && ! contact ) {
				missing = true;
				if ( contactInput ) {
					contactInput.focus();
				}
			}

			if ( missing ) {
				return;
			}
		}

		if ( name ) {
			store.set( NAME_KEY, name );
		}

		el.prechat.hidden = true;
		state.prechatDone = true;

		if ( name || contact ) {
			request( '/session', {
				token:   state.token,
				name:    name,
				contact: contact,
				page:    C.page || window.location.href
			}, 'POST' )
				.then( function ( payload ) {
					applySession( payload );
				} )
				.catch( function () {} );
		}

		if ( el.input ) {
			el.input.focus();
		}
	}

	function restartChat() {
		request( '/restart', { token: state.token }, 'POST' )
			.then( function ( payload ) {
				store.del( SEEN_KEY );

				if ( el.list ) {
					el.list.innerHTML = '';
				}

				state.lastId  = 0;
				state.lastDay = '';

				applySession( payload );
				appendMessages( payload.messages, true );
				setClosed( false );
				clearNotice( 'closed' );
				syncEmpty();

				if ( el.input ) {
					el.input.disabled = false;
					el.input.focus();
				}
			} )
			.catch( function ( err ) {
				notice( err.message || t( 'failed', 'خطا' ), 'error' );
			} );
	}

	/* ------------------------------------------------------------------
	 * polling
	 * ---------------------------------------------------------------- */

	function startPolling() {
		stopPolling();

		if ( ! state.ready ) {
			return;
		}

		if ( document.hidden ) {
			return;
		}

		var interval = state.open ? C.poll : C.pollClosed;

		state.timer = window.setInterval( function () {
			pollNow( false );
		}, interval );
	}

	function stopPolling() {
		if ( state.timer ) {
			window.clearInterval( state.timer );
			state.timer = null;
		}
	}

	function pollNow( forceScroll ) {
		if ( ! state.token ) {
			return window.Promise.resolve( null );
		}

		return request( '/messages' + buildQuery( { token: state.token, after: state.lastId } ), null, 'GET' )
			.then( function ( payload ) {
				if ( payload && payload.session ) {
					state.session = payload.session;
					setStatus();
					setClosed( 'closed' === state.session.status );
				}

				if ( payload && typeof payload.online !== 'undefined' ) {
					var wasOnline = C.online;

					C.online = flag( payload.online );

					if ( wasOnline !== C.online ) {
						setStatus();
						clearNotice( 'offline' );

						if ( ! C.online && C.offlineNote ) {
							notice( C.offlineNote, 'offline' );
						}
					}
				}

				var added = appendMessages( payload ? payload.messages : [], forceScroll );

				if ( added && ! state.open ) {
					setUnread( state.unread + added );
					beep();
				} else if ( added && state.open ) {
					setUnread( 0 );
					beep();
					showTyping( false );
				}

				return added;
			} )
			.catch( function () {
				return 0;
			} );
	}

	function markRead() {
		if ( ! state.token ) {
			return;
		}

		request( '/read', { token: state.token }, 'POST' ).catch( function () {} );
	}

	/* ------------------------------------------------------------------
	 * sending
	 * ---------------------------------------------------------------- */

	function send( text ) {
		var value = String( text === undefined || text === null ? '' : text ).trim();

		if ( ! value ) {
			return window.Promise.resolve( null );
		}

		if ( value.length > C.maxLength ) {
			notice( t( 'tooLong', 'پیام خیلی طولانی است.' ), 'error' );
			return window.Promise.resolve( null );
		}

		if ( el.input ) {
			el.input.value = '';
			grow();
		}

		/* No conversation yet - create one first, then send. */
		if ( ! state.ready ) {
			state.queued = value;
			boot();
			return window.Promise.resolve( null );
		}

		var temp = {
			id:     0,
			sender: 'visitor',
			body:   value,
			ts:     Math.floor( Date.now() / 1000 )
		};

		var node = messageNode( temp, true );

		if ( node && el.list ) {
			el.list.appendChild( node );
			syncEmpty();
			scrollToBottom( true );
		}

		setClosed( false );
		clearNotice( 'error' );

		state.pending++;

		return request( '/message', { token: state.token, message: value }, 'POST' )
			.then( function ( payload ) {
				state.pending--;

				if ( node && payload && payload.message ) {
					var real = messageNode( payload.message, false );

					if ( real ) {
						node.parentNode.replaceChild( real, node );
					}

					if ( num( payload.message.id, 0 ) > state.lastId ) {
						state.lastId = num( payload.message.id, 0 );
					}
				}

				if ( payload && payload.session ) {
					state.session = payload.session;
					setStatus();
					setClosed( 'closed' === state.session.status );
				}

				if ( payload && typeof payload.online !== 'undefined' ) {
					C.online = flag( payload.online );
					setStatus();
				}

				scrollToBottom( true );
				emit( 'tmbc:message', { message: payload ? payload.message : temp } );

				return payload;
			} )
			.catch( function ( err ) {
				state.pending--;

				if ( node ) {
					node.className += ' tmbc-failed';

					var meta = node.querySelector( '.tmbc-meta' );

					if ( meta ) {
						var retry = document.createElement( 'button' );
						retry.type = 'button';
						retry.className = 'tmbc-retry';
						retry.textContent = t( 'retry', 'تلاش دوباره' );
						retry.addEventListener( 'click', function () {
							if ( node.parentNode ) {
								node.parentNode.removeChild( node );
							}
							send( value );
						} );
						meta.appendChild( retry );
					}
				}

				if ( 429 === err.status ) {
					notice( err.message || C.rateNote, 'error' );
				} else if ( 'tmb_no_session' === err.code ) {
					store.del( TOKEN_KEY );
					state.token = '';
					state.ready = false;
					boot();
				} else {
					notice( err.message || t( 'failed', 'ارسال ناموفق بود.' ), 'error' );
				}

				return null;
			} );
	}

	function grow() {
		if ( ! el.input ) {
			return;
		}

		el.input.style.height = 'auto';
		el.input.style.height = Math.min( 120, el.input.scrollHeight ) + 'px';
	}

	/* ------------------------------------------------------------------
	 * events
	 * ---------------------------------------------------------------- */

	if ( el.toggle ) {
		el.toggle.addEventListener( 'click', function ( e ) {
			e.preventDefault();
			toggle();
		} );
	}

	if ( el.closeBtn ) {
		el.closeBtn.addEventListener( 'click', close );
	}

	if ( el.overlay ) {
		el.overlay.addEventListener( 'click', close );
	}

	if ( el.newBtn ) {
		el.newBtn.addEventListener( 'click', restartChat );
	}

	if ( el.skip ) {
		el.skip.addEventListener( 'click', function () {
			submitPrechat( true );
		} );
	}

	if ( el.prechat ) {
		el.prechat.addEventListener( 'submit', function ( e ) {
			e.preventDefault();
			submitPrechat( false );
		} );
	}

	if ( el.composer ) {
		el.composer.addEventListener( 'submit', function ( e ) {
			e.preventDefault();

			if ( ! el.input ) {
				return;
			}

			send( el.input.value );
		} );
	}

	if ( el.input ) {
		el.input.addEventListener( 'input', grow );

		el.input.addEventListener( 'keydown', function ( e ) {
			if ( 13 === e.keyCode && ! e.shiftKey ) {
				e.preventDefault();
				send( el.input.value );
			}
		} );
	}

	document.addEventListener( 'keydown', function ( e ) {
		if ( 27 === e.keyCode && state.open ) {
			close();
		}
	} );

	document.addEventListener( 'visibilitychange', function () {
		if ( document.hidden ) {
			stopPolling();
		} else {
			pollNow( false );
			startPolling();

			if ( state.open ) {
				markRead();
			}
		}
	} );

	window.addEventListener( 'resize', function () {
		if ( el.overlay && state.open ) {
			el.overlay.hidden = window.innerWidth > 768;
		}
	} );

	/*
	 * Last resort: the chat item is a plain anchor to #tmb-chat. If anything on
	 * the page swallows the click before it reaches us, the browser still puts
	 * #tmb-chat in the address bar - so treat that hash as "open the chat".
	 */
	function hashOpen() {
		if ( window.location && '#tmb-chat' === String( window.location.hash ) ) {
			open();
		}
	}

	window.addEventListener( 'hashchange', hashOpen );

	/* contact box items + shortcode buttons + anything pointing at #tmb-chat */
	window.addEventListener( 'click', function ( e ) {
		var node = e.target;

		while ( node && node !== document ) {
			if ( node.getAttribute ) {
				var action = node.getAttribute( 'data-tmb-action' );
				var href   = node.getAttribute( 'href' );

				if ( 'chat' === action || '#tmb-chat' === href || node.hasAttribute( 'data-tmbc-open' ) ) {
					e.preventDefault();
					e.stopPropagation();

					/* let the contact box panel close behind the chat window */
					if ( window.TamasBox && 'function' === typeof window.TamasBox.close ) {
						try {
							window.TamasBox.close();
						} catch ( err ) {}
					}

					open();
					return;
				}
			}

			node = node.parentNode;
		}
	}, true );

	/* ------------------------------------------------------------------
	 * boot
	 * ---------------------------------------------------------------- */

	function autoOpen() {
		if ( ! C.autoOpen || store.get( OPEN_KEY ) ) {
			return;
		}

		store.set( OPEN_KEY, '1' );

		state.autoTimer = window.setTimeout( function () {
			open( false );
		}, Math.max( 0, C.autoDelay ) * 1000 );
	}

	function init() {
		if ( el.input ) {
			el.input.setAttribute( 'maxlength', String( C.maxLength ) );
			grow();
		}

		setUnread( 0 );

		/*
		 * Only talk to the server when there is something to resume. A brand
		 * new visitor gets a conversation as soon as the window is opened (or
		 * the first message is typed), which keeps the tables clean.
		 */
		if ( state.token ) {
			boot();
		} else {
			root.classList.add( 'tmbc-idle' );
			setStatus();

			if ( ! C.online && C.offlineNote ) {
				notice( C.offlineNote, 'offline' );
			}
		}

		autoOpen();
		hashOpen();

		/* unread counter for the contact box badges */
		if ( C.badge ) {
			window.setTimeout( function () {
				pollNow( false );
			}, 1500 );
		}
	}

	if ( 'loading' === document.readyState ) {
		document.addEventListener( 'DOMContentLoaded', init );
	} else {
		init();
	}

	/* ------------------------------------------------------------------
	 * public api
	 * ---------------------------------------------------------------- */

	window.TamasBoxChat = {
		open: function () {
			open();
		},
		close: function () {
			close();
		},
		toggle: function () {
			toggle();
		},
		isOpen: function () {
			return state.open;
		},
		send: function ( text ) {
			open();
			return send( text );
		},
		unread: function () {
			return state.unread;
		},
		session: function () {
			return state.session;
		},
		restart: function () {
			open();
			restartChat();
		},
		config: function () {
			return C;
		},
		version: txt( RAW.version, '' )
	};

	return true;
}

/* ------------------------------------------------------------------
 * entry point
 * ---------------------------------------------------------------- */

( function () {
	/*
	 * The guard goes on FIRST, whatever happens next. If booting throws halfway
	 * (an old browser, a theme that breaks a DOM api, a js error above us) the
	 * chat button still does not turn into a plain #tmb-chat link, and the
	 * reason ends up in window.TMB_CHAT_ERROR where the self test can find it.
	 */
	tmbChatGuard( 'booting', true );

	if ( ! window.Promise ) {
		window.TMB_CHAT_ERROR = 'window.Promise is not available';
		tmbChatGuard( 'no-promise' );
		return;
	}

	/**
	 * Boot, with every failure made visible.
	 *
	 * @param {object} cfg Widget configuration.
	 */
	function run( cfg ) {
		try {
			if ( false === tmbChatBoot( cfg ) ) {
				window.TMB_CHAT_ERROR = window.TMB_CHAT_ERROR || 'widget markup (#tmbc-root) is missing from the page';
				tmbChatGuard( 'no-markup' );
				return;
			}

			if ( document.body ) {
				document.body.removeAttribute( 'data-tmbc-state' );
			}
		} catch ( err ) {
			window.TMB_CHAT_ERROR = String( ( err && err.stack ) || err );

			if ( window.console && window.console.error ) {
				window.console.error( '[Tamas Box Chat] راه‌اندازی ویجت ناموفق بود:', err );
			}

			tmbChatGuard( 'boot-error' );
		}
	}

	/**
	 * Wait for the widget markup, then boot.
	 *
	 * This is the race that made the chat button look dead: WordPress prints
	 * footer scripts on wp_footer at priority 20, while the widget itself is
	 * printed later in the same hook. So this file can run a few milliseconds
	 * before #tmbc-root exists - getElementById returns null and the widget used
	 * to give up right there.
	 *
	 * @param {object} cfg Widget configuration.
	 */
	function start( cfg ) {
		window.TMB_CHAT = cfg;

		if ( document.getElementById( 'tmbc-root' ) ) {
			run( cfg );
			return;
		}

		var tries = 0;

		function found() {
			return !! document.getElementById( 'tmbc-root' );
		}

		function poll() {
			var timer = window.setInterval( function () {
				tries++;

				if ( found() ) {
					window.clearInterval( timer );
					run( cfg );
					return;
				}

				if ( tries >= 50 ) {
					window.clearInterval( timer );
					window.TMB_CHAT_ERROR = 'widget markup (#tmbc-root) never appeared';
					tmbChatGuard( 'no-markup' );
				}
			}, 100 );
		}

		if ( 'loading' === document.readyState ) {
			document.addEventListener( 'DOMContentLoaded', function () {
				if ( found() ) {
					run( cfg );
				} else {
					poll();
				}
			} );
		} else {
			poll();
		}
	}

	var cfg = tmbChatPickConfig();

	if ( cfg && cfg.rest ) {
		start( cfg );
		return;
	}

	/*
	 * The inline configuration is not there yet: a js optimiser may print it
	 * after this file, or a page cache may have stored a half built page.
	 * Keep looking for a few seconds instead of leaving a dead button.
	 */
	var tries = 0;
	var timer = window.setInterval( function () {
		tries++;
		cfg = tmbChatPickConfig();

		if ( cfg && cfg.rest ) {
			window.clearInterval( timer );
			start( cfg );
		} else if ( tries >= 30 ) {
			window.clearInterval( timer );
			window.TMB_CHAT_ERROR = 'no configuration found (TMB_CHAT, data-tmbc-config, data-tmbc-rest, origin)';
			tmbChatGuard( 'no-config' );
		}
	}, 100 );
} )();
