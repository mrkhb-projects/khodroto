/**
 * Tamas Box - dashboard side of the live chat.
 *
 * Two jobs:
 *   1. On the settings screen  -> Bale connection helpers (test / webhook)
 *                                 + the "chat item" quick add button.
 *   2. On the "گفتگوها" screen -> the conversations inbox.
 */
( function ( $ ) {
	'use strict';

	var DATA = window.TMB_CHAT_ADMIN || {};

	if ( ! DATA.rest ) {
		return;
	}

	var I = DATA.i18n || {};

	/* ------------------------------------------------------------------
	 * shared helpers
	 * ---------------------------------------------------------------- */

	function esc( value ) {
		return String( value === undefined || value === null ? '' : value )
			.replace( /&/g, '&amp;' )
			.replace( /</g, '&lt;' )
			.replace( />/g, '&gt;' )
			.replace( /"/g, '&quot;' )
			.replace( /'/g, '&#039;' );
	}

	function toFa( value ) {
		try {
			return String( value ).replace( /\d/g, function ( d ) {
				return '۰۱۲۳۴۵۶۷۸۹'[ d ];
			} );
		} catch ( e ) {
			return String( value );
		}
	}

	var timeFmt = null;
	var dayFmt  = null;

	try {
		if ( window.Intl && window.Intl.DateTimeFormat ) {
			timeFmt = new window.Intl.DateTimeFormat( 'fa-IR', { hour: '2-digit', minute: '2-digit' } );
			dayFmt  = new window.Intl.DateTimeFormat( 'fa-IR', { month: 'short', day: 'numeric' } );
		}
	} catch ( e ) {
		timeFmt = null;
	}

	function fmtTime( ts ) {
		var d = new Date( parseInt( ts, 10 ) * 1000 );

		if ( isNaN( d.getTime() ) ) {
			return '';
		}

		if ( timeFmt ) {
			try {
				return timeFmt.format( d );
			} catch ( e ) {}
		}

		return ( d.getHours() < 10 ? '0' : '' ) + d.getHours() + ':' + ( d.getMinutes() < 10 ? '0' : '' ) + d.getMinutes();
	}

	function fmtDay( ts ) {
		var d = new Date( parseInt( ts, 10 ) * 1000 );

		if ( isNaN( d.getTime() ) ) {
			return '';
		}

		if ( dayFmt ) {
			try {
				return dayFmt.format( d );
			} catch ( e ) {}
		}

		return ( d.getMonth() + 1 ) + '/' + d.getDate();
	}

	function stamp( ts ) {
		var now = Math.floor( Date.now() / 1000 );
		var diff = now - parseInt( ts, 10 );

		if ( diff < 60 ) {
			return 'همین حالا';
		}
		if ( diff < 3600 ) {
			return toFa( Math.floor( diff / 60 ) ) + ' دقیقه پیش';
		}
		if ( diff < 86400 ) {
			return fmtTime( ts );
		}

		return fmtDay( ts ) + ' · ' + fmtTime( ts );
	}

	function beep() {
		try {
			var Ctx = window.AudioContext || window.webkitAudioContext;

			if ( ! Ctx ) {
				return;
			}

			var ctx  = beep.ctx || ( beep.ctx = new Ctx() );
			var osc  = ctx.createOscillator();
			var gain = ctx.createGain();

			osc.type = 'triangle';
			osc.frequency.value = 660;
			gain.gain.value = 0.0001;

			osc.connect( gain );
			gain.connect( ctx.destination );

			var now = ctx.currentTime;
			gain.gain.exponentialRampToValueAtTime( 0.06, now + 0.02 );
			gain.gain.exponentialRampToValueAtTime( 0.0001, now + 0.3 );

			osc.start( now );
			osc.stop( now + 0.32 );
		} catch ( e ) {}
	}

	function rest( path, data, method ) {
		var verb = method || 'GET';
		var url  = DATA.rest + path;
		var opts = {
			url: url,
			method: verb,
			headers: { 'X-WP-Nonce': DATA.nonce },
			xhrFields: { withCredentials: true }
		};

		if ( data && 'GET' === verb ) {
			url += ( url.indexOf( '?' ) === -1 ? '?' : '&' ) + $.param( data );
			opts.url = url;
		} else if ( data ) {
			opts.contentType = 'application/json';
			opts.data = JSON.stringify( data );
		}

		return $.ajax( opts ).then(
			function ( payload ) {
				return payload;
			},
			function ( xhr ) {
				var msg = I.error || 'خطا';

				if ( xhr && xhr.responseJSON && xhr.responseJSON.message ) {
					msg = xhr.responseJSON.message;
				}

				return $.Deferred().reject( msg, xhr ).promise();
			}
		);
	}

	function ajaxAdmin( action, extra ) {
		var payload = $.extend( { action: action, nonce: DATA.ajaxNonce }, extra || {} );

		return $.post( DATA.ajaxUrl, payload, null, 'json' );
	}

	/* ==================================================================
	 * 1. SETTINGS SCREEN
	 * ================================================================== */

	function initSettings() {
		var $tab = $( '#tab-chat' );

		if ( ! $tab.length ) {
			return;
		}

		var $result = $tab.find( '[data-tmb-chat-result]' );

		function showResult( text, kind, extra ) {
			if ( ! $result.length ) {
				return;
			}

			$result
				.attr( 'hidden', false )
				.removeClass( 'is-ok is-error is-info is-busy' )
				.addClass( 'is-' + ( kind || 'info' ) )
				.html( '<pre>' + esc( text ) + '</pre>' + ( extra || '' ) );
		}

		function busy( on, label ) {
			$tab.find( '[data-tmb-chat]' ).prop( 'disabled', !! on );

			if ( on ) {
				showResult( label || I.working || '…', 'busy' );
			}
		}

		function botValues() {
			return {
				token: $.trim( $tab.find( '.tmb-chat-token' ).val() || '' ),
				base: $.trim( $tab.find( '.tmb-chat-base' ).val() || '' )
			};
		}

		/* ---- connection buttons ---- */
		$tab.on( 'click', '[data-tmb-chat]', function ( e ) {
			e.preventDefault();

			var $btn = $( this );
			var what = $btn.data( 'tmb-chat' );

			if ( 'copy-webhook' === what ) {
				var $input = $( '#tmb-webhook-url' );

				$input.trigger( 'focus' ).trigger( 'select' );

				try {
					if ( navigator.clipboard && navigator.clipboard.writeText ) {
						navigator.clipboard.writeText( $input.val() );
					} else {
						document.execCommand( 'copy' );
					}
					showResult( 'آدرس وب‌هوک کپی شد ✔', 'ok' );
				} catch ( err ) {
					showResult( 'کپی نشد؛ آدرس را دستی انتخاب و کپی کنید.', 'info' );
				}

				return;
			}

			var action = '';
			var label  = '';

			switch ( what ) {
				case 'test':
					action = 'tmb_chat_test';
					label  = 'در حال تست اتصال به بله…';
					break;
				case 'set-webhook':
					action = 'tmb_chat_set_webhook';
					label  = 'در حال ثبت وب‌هوک…';
					break;
				case 'delete-webhook':
					action = 'tmb_chat_delete_webhook';
					label  = 'در حال حذف وب‌هوک…';
					break;
				case 'webhook-info':
					action = 'tmb_chat_webhook_info';
					label  = 'در حال دریافت وضعیت وب‌هوک…';
					break;
				case 'poll-now':
					action = 'tmb_chat_poll_now';
					label  = 'در حال دریافت پیام‌ها از بله…';
					break;
				case 'admin-link':
					action = 'tmb_chat_admin_link';
					label  = 'در حال ساخت لینک ثبت مدیر…';
					break;
				case 'item-first':
					action = 'tmb_chat_item_first';
					label  = 'در حال انتقال دکمه چت به اول فهرست…';
					break;
				case 'purge-cache':
					action = 'tmb_chat_purge_cache';
					label  = 'در حال پاک کردن کش سایت…';
					break;
				case 'diag':
					action = 'tmb_chat_diag';
					label  = 'در حال تهیه گزارش عیب‌یابی… (چند ثانیه)';
					break;
				default:
					return;
			}

			if ( ! DATA.ajaxUrl ) {
				return;
			}

			busy( true, label );

			ajaxAdmin( action, botValues() )
				.done( function ( res ) {
					busy( false );

					if ( res && res.success ) {
						var msg = ( res.data && res.data.message ) ? res.data.message : 'انجام شد ✔';
						var note = '';

						if ( res.data && res.data.hint ) {
							note = '<p class="tmb-note">' + esc( res.data.hint ) + '</p>';
						}
						if ( 'test' === what && res.data ) {
							if ( res.data.base ) {
								$tab.find( '.tmb-chat-base' ).val( res.data.base );
								note += '<p class="tmb-note">آدرس API قابل استفاده: <code>' + esc( res.data.base ) + '</code></p>';
							}

							if ( res.data.bot ) {
								if ( res.data.bot.username ) {
									$tab.find( 'input[name*="[bale_bot_username]"]' ).val( res.data.bot.username );
								}
								if ( res.data.bot.first_name ) {
									$tab.find( 'input[name*="[bale_bot_name]"]' ).val( res.data.bot.first_name );
								}
							}
						}
						if ( res.data && 0 === res.data.match && 'webhook-info' === what ) {
							note += '<p class="tmb-note tmb-note-warn">آدرس ثبت‌شده با آدرس افزونه یکی نیست؛ «ثبت وب‌هوک» را بزنید.</p>';
						}

						if ( res.data && res.data.url && 'admin-link' === what ) {
							note += '<p class="tmb-joinlink"><input type="text" class="ltr" readonly value="' + esc( res.data.url ) +
								'" onclick="this.select()" dir="ltr">' +
								'<a class="button button-primary" href="' + esc( res.data.url ) + '" target="_blank" rel="noopener">باز کردن در بله</a></p>';
						}

						showResult( msg, 'diag' === what ? 'info is-diag' : 'ok', note );
					} else {
						var err = ( res && res.data && res.data.message ) ? res.data.message : ( I.error || 'خطا' );
						var hint = ( res && res.data && res.data.hint ) ? '<p class="tmb-note">' + esc( res.data.hint ) + '</p>' : '';

						showResult( '✖ ' + err, 'error', hint );
					}
				} )
				.fail( function () {
					busy( false );
					showResult( '✖ ' + ( I.error || 'خطا در ارتباط با سرور.' ), 'error' );
				} );
		} );

		/* ---- colour presets of the chat window ---- */
		$tab.on( 'click', '[data-tmb-chat-preset]', function ( e ) {
			e.preventDefault();

			var $btn = $( this );

			function paint( key, value ) {
				if ( ! value ) {
					return;
				}

				var $input = $tab.find( 'input[name*="[chat][' + key + ']"]' ).first();

				if ( ! $input.length ) {
					return;
				}

				$input.val( value );

				try {
					if ( $input.hasClass( 'wp-color-picker' ) ) {
						$input.wpColorPicker( 'color', value );
					}
				} catch ( err ) {}

				$input.trigger( 'change' );
			}

			paint( 'accent', $btn.data( 'accent' ) );
			paint( 'header_bg', $btn.data( 'head' ) );
			paint( 'header_text', $btn.data( 'fg' ) );
			paint( 'bubble_visitor', $btn.data( 'head' ) );
			paint( 'bubble_visitor_text', $btn.data( 'fg' ) );
			paint( 'launcher_color_1', $btn.data( 'head' ) );
			paint( 'launcher_color_2', $btn.data( 'head2' ) );
			paint( 'launcher_fg', $btn.data( 'fg' ) );
			paint( 'panel_bg', $btn.data( 'panel' ) );

			$( '#tmb-form' ).trigger( 'change' );
		} );

		/* ---- "chat" item type inside the contact boxes ---- */
		function syncItem( $item ) {
			var action = $item.find( '.tmb-item-action' ).val() || 'link';
			var chat = ( 'chat' === action );

			$item.toggleClass( 'tmb-item-is-chat', chat ).attr( 'data-action', action );
			$item.find( '.tmb-item-url-field' ).toggle( ! chat );
			$item.find( '.tmb-item-chat-note' ).attr( 'hidden', ! chat );

			var $url = $item.find( '.tmb-item-url' );

			if ( chat ) {
				if ( ! $url.data( 'tmb-prev' ) ) {
					$url.data( 'tmb-prev', $url.val() );
				}
				$url.val( '#tmb-chat' );
			} else if ( '#tmb-chat' === $url.val() ) {
				$url.val( $url.data( 'tmb-prev' ) || '' );
			}
		}

		$( '#tmb-boxes' ).on( 'change', '.tmb-item-action', function () {
			var $item = $( this ).closest( '.tmb-item' );

			syncItem( $item );

			if ( 'chat' === $( this ).val() ) {
				$item.find( '.tmb-iconopt[data-icon="chat"]' ).first().trigger( 'click' );

				var $label = $item.find( '.tmb-item-label' );

				if ( ! $.trim( $label.val() ) ) {
					$label.val( 'چت آنلاین' ).trigger( 'change' );
				}
			}

			$item.find( '.tmb-item-label' ).trigger( 'change' );
		} );

		$( document ).on( 'click', '.tmb-add-chat-item', function ( e ) {
			e.preventDefault();

			var $box = $( this ).closest( '.tmb-box' );
			var $add = $box.find( '.tmb-add-item' ).first();

			if ( ! $add.length ) {
				return;
			}

			/* let the core script build the item (colours, sortables, preview) */
			$add.trigger( 'click' );

			window.setTimeout( function () {
				var $item = $box.find( '.tmb-items-list > .tmb-item' ).last();

				if ( ! $item.length ) {
					return;
				}

				$item.find( '.tmb-item-action' ).val( 'chat' );
				syncItem( $item );

				$item.find( '.tmb-iconopt[data-icon="chat"]' ).first().trigger( 'click' );
				$item.find( '.tmb-item-label' ).val( 'چت آنلاین' ).trigger( 'change' );
				$item.find( '.tmb-item-sub' ).val( 'پاسخگویی آنلاین' ).trigger( 'change' );
			}, 60 );
		} );

		/* a phone number is not a chat id - say so while they type */
		function checkIds() {
			var $ids = $tab.find( '.tmb-chat-ids' );

			if ( ! $ids.length ) {
				return;
			}

			var lines = String( $ids.val() || '' ).split( /[\r\n,;،]+/ );
			var phone = false;

			for ( var i = 0; i < lines.length; i++ ) {
				var v = $.trim( lines[ i ] ).replace( /[\s\-()]/g, '' );

				if ( ! v ) {
					continue;
				}

				if ( /^(\+?98|0)?9\d{9}$/.test( v ) || /^\+?\d{10,13}$/.test( v ) ) {
					phone = true;
				}
			}

			$ids.toggleClass( 'tmb-field-error', phone );
			$tab.find( '.tmb-phone-note' ).toggleClass( 'tmb-note-strong', phone );
		}

		$tab.on( 'input change', '.tmb-chat-ids', checkIds );
		checkIds();

		/* existing items on load */
		$( '#tmb-boxes .tmb-item' ).each( function () {
			syncItem( $( this ) );
		} );

		/* keep the URL field hidden while the item editor is collapsed */
		$( document ).on( 'click', '.tmb-toggle-item', function () {
			window.setTimeout( function () {
				$( '#tmb-boxes .tmb-item' ).each( function () {
					syncItem( $( this ) );
				} );
			}, 80 );
		} );
	}

	/* ==================================================================
	 * 2. INBOX
	 * ================================================================== */

	function initInbox() {
		var $wrap = $( '#tmb-inbox' );

		if ( ! $wrap.length ) {
			return;
		}

		var $list     = $( '#tmb-inbox-list' );
		var $empty    = $( '#tmb-inbox-empty' );
		var $thread   = $( '#tmb-inbox-thread' );
		var $body     = $( '#tmb-thread-body' );
		var $input    = $( '#tmb-thread-input' );
		var $form     = $( '#tmb-thread-composer' );
		var $name     = $thread.find( '[data-thread-name]' );
		var $meta     = $thread.find( '[data-thread-meta]' );
		var $info     = $thread.find( '[data-thread-info]' );
		var $statusBtn= $thread.find( '[data-thread-status]' );
		var $pageBtn  = $thread.find( '[data-thread-page]' );
		var $delBtn   = $thread.find( '[data-thread-delete]' );
		var $prev     = $( '#tmb-inbox-prev' );
		var $next     = $( '#tmb-inbox-next' );
		var $pageInfo = $( '#tmb-inbox-pageinfo' );
		var $search   = $( '#tmb-inbox-search' );

		var S = {
			filter: '',
			search: '',
			paged: 1,
			pages: 1,
			total: 0,
			id: 0,
			lastId: 0,
			status: 'open',
			loadingList: false,
			loadingThread: false,
			timer: null
		};

		/* ---------- list ---------- */

		function listParams() {
			var params = {
				paged: S.paged,
				per_page: 25
			};

			if ( 'unread' === S.filter ) {
				params.unread = 1;
			} else if ( S.filter ) {
				params.status = S.filter;
			}

			if ( S.search ) {
				params.search = S.search;
			}

			return params;
		}

		function sessionRow( item ) {
			var name = item.name ? item.name : ( I.guest || 'مهمان' );
			var last = item.lastMessage || '';
			var who  = 'visitor' === item.lastSender ? ( I.visitor || 'کاربر' ) : ( 'agent' === item.lastSender ? ( I.agent || 'پشتیبانی' ) : '' );
			var unread = parseInt( item.unreadAgent, 10 ) > 0;

			var html = '<button type="button" class="tmb-ses' + ( unread ? ' is-unread' : '' ) + ( 'closed' === item.status ? ' is-closed' : '' ) + '"' +
				' data-id="' + parseInt( item.id, 10 ) + '" role="option">' +
				'<span class="tmb-ses-top">' +
					'<span class="tmb-ses-name">' + esc( name ) + '</span>' +
					'<span class="tmb-ses-time">' + esc( stamp( item.lastAt || item.createdAt ) ) + '</span>' +
				'</span>' +
				'<span class="tmb-ses-last">' + ( who ? '<em>' + esc( who ) + ':</em> ' : '' ) + esc( last ) + '</span>' +
				'<span class="tmb-ses-bottom">' +
					'<span class="tmb-ses-chip ' + ( 'closed' === item.status ? 'is-closed' : 'is-open' ) + '">' +
						esc( 'closed' === item.status ? ( I.closed || 'بسته' ) : ( I.open || 'باز' ) ) +
					'</span>' +
					( item.contact ? '<span class="tmb-ses-contact" dir="ltr">' + esc( item.contact ) + '</span>' : '' ) +
					( unread ? '<span class="tmb-ses-badge">' + toFa( parseInt( item.unreadAgent, 10 ) ) + '</span>' : '' ) +
				'</span>' +
			'</button>';

			return html;
		}

		function updateCounters( counters ) {
			if ( ! counters ) {
				return;
			}

			$( '[data-count-open]' ).text( toFa( counters.open || 0 ) );
			$( '[data-count-unread]' ).text( toFa( counters.unread || 0 ) );

			var $menu = $( '#toplevel_page_tamas-box a[href*="tamas-box-chats"] .awaiting-mod, ' +
				'#toplevel_page_tamas-box a[href*="tamas-box-chats"] .update-plugins' );

			if ( $menu.length ) {
				if ( counters.unread > 0 ) {
					$menu.show().find( '.pending-count' ).text( counters.unread );
				} else {
					$menu.hide();
				}
			}
		}

		function loadList( quiet ) {
			if ( S.loadingList ) {
				return;
			}

			S.loadingList = true;

			if ( ! quiet ) {
				$list.html( '<p class="tmb-inbox-loading">' + esc( I.loading || '…' ) + '</p>' );
			}

			rest( '/admin/sessions', listParams(), 'GET' )
				.done( function ( res ) {
					S.loadingList = false;

					var items = ( res && res.items ) ? res.items : [];

					S.pages = ( res && res.pages ) ? res.pages : 1;
					S.total = ( res && res.total ) ? res.total : 0;

					if ( ! items.length ) {
						$list.html( '<p class="tmb-inbox-loading">' + esc( I.empty || '—' ) + '</p>' );
					} else {
						var html = '';

						for ( var i = 0; i < items.length; i++ ) {
							html += sessionRow( items[ i ] );
						}

						$list.html( html );
						$list.find( '.tmb-ses[data-id="' + S.id + '"]' ).addClass( 'is-active' );
					}

					$prev.prop( 'disabled', S.paged <= 1 );
					$next.prop( 'disabled', S.paged >= S.pages );
					$pageInfo.text( toFa( S.paged ) + ' / ' + toFa( S.pages ) );

					updateCounters( res ? res.counters : null );
				} )
				.fail( function ( msg ) {
					S.loadingList = false;

					if ( ! quiet ) {
						$list.html( '<p class="tmb-inbox-loading tmb-inbox-error">' + esc( msg ) + '</p>' );
					}
				} );
		}

		/* ---------- thread ---------- */

		function messageRow( msg ) {
			var sender = msg.sender || 'visitor';
			var cls = 'visitor' === sender ? 'them' : ( 'agent' === sender ? 'me' : 'sys' );
			var who = 'agent' === sender
				? ( msg.agent || I.agent || 'پشتیبانی' )
				: ( 'system' === sender ? ( I.system || 'سیستم' ) : ( I.visitor || 'بازدیدکننده' ) );

			var att = '';

			if ( msg.attachment && msg.attachment.url ) {
				var type = msg.attachment.type || 'file';
				var url = msg.attachment.url;

				if ( 'photo' === type || 'sticker' === type || 'gif' === type ) {
					att = '<a class="tmb-att-img" href="' + esc( url ) + '" target="_blank" rel="noopener"><img src="' + esc( url ) + '" alt=""></a>';
				} else if ( 'voice' === type || 'audio' === type ) {
					att = '<audio class="tmb-att-audio" controls preload="none" src="' + esc( url ) + '"></audio>';
				} else if ( 'video' === type ) {
					att = '<video class="tmb-att-audio" controls preload="none" src="' + esc( url ) + '"></video>';
				} else {
					att = '<a class="tmb-att-file" href="' + esc( url ) + '" target="_blank" rel="noopener">📎 ' + esc( msg.attachment.name || I.download || 'فایل' ) + '</a>';
				}
			}

			var origin = '';

			if ( 'bale' === msg.origin ) {
				origin = '<span class="tmb-msg-origin" title="از بله">بله</span>';
			} else if ( 'wp' === msg.origin ) {
				origin = '<span class="tmb-msg-origin" title="از پیشخوان">پیشخوان</span>';
			}

			return '<div class="tmb-msg is-' + cls + '" data-id="' + parseInt( msg.id, 10 ) + '">' +
				'<div class="tmb-msg-bubble">' +
					( 'sys' === cls ? '' : '<span class="tmb-msg-who">' + esc( who ) + '</span>' ) +
					( msg.body ? '<span class="tmb-msg-text">' + esc( msg.body ).replace( /\n/g, '<br>' ) + '</span>' : '' ) +
					att +
				'</div>' +
				'<div class="tmb-msg-meta">' + origin + '<span>' + esc( fmtTime( msg.ts ) ) + '</span></div>' +
			'</div>';
		}

		function renderInfo( session ) {
			var bits = [];

			if ( session.contact ) {
				bits.push( '<span class="tmb-info-chip">📞 <b dir="ltr">' + esc( session.contact ) + '</b>' +
					' <a href="tel:' + esc( session.contact ) + '">تماس</a>' +
					' <a href="sms:' + esc( session.contact ) + '">پیامک</a>' +
					' <a href="https://wa.me/' + esc( String( session.contact ).replace( /[^0-9]/g, '' ) ) + '" target="_blank" rel="noopener">واتساپ</a></span>' );
			}

			if ( session.pageUrl ) {
				bits.push( '<span class="tmb-info-chip">🌐 <a href="' + esc( session.pageUrl ) + '" target="_blank" rel="noopener">' + esc( String( session.pageUrl ).replace( /^https?:\/\//, '' ) ) + '</a></span>' );
			}

			if ( session.ip ) {
				bits.push( '<span class="tmb-info-chip">IP <b dir="ltr">' + esc( session.ip ) + '</b></span>' );
			}

			if ( session.userId ) {
				bits.push( '<span class="tmb-info-chip">👤 ' + esc( 'کاربر ثبت‌نام‌شده #' + session.userId ) + '</span>' );
			}

			bits.push( '<span class="tmb-info-chip">💬 ' + toFa( parseInt( session.visitorCount, 10 ) || 0 ) + ' پیام کاربر · ' + toFa( parseInt( session.agentCount, 10 ) || 0 ) + ' پاسخ</span>' );
			bits.push( '<span class="tmb-info-chip">🕒 شروع: ' + esc( stamp( session.createdAt ) ) + '</span>' );

			$info.html( bits.join( '' ) );
		}

		function renderThread( session, messages ) {
			S.status = session.status || 'open';

			$name.text( session.name ? session.name : ( I.guest || 'مهمان' ) );
			$meta.text( '#' + session.id + ' · ' + ( 'closed' === S.status ? ( I.closed || 'بسته' ) : ( I.open || 'باز' ) ) + ' · ' + stamp( session.lastAt || session.createdAt ) );

			$statusBtn
				.text( 'closed' === S.status ? ( I.reopenChat || 'باز کردن گفتگو' ) : ( I.closeChat || 'بستن گفتگو' ) )
				.toggleClass( 'button-primary', 'closed' === S.status );

			if ( session.pageUrl ) {
				$pageBtn.attr( 'href', session.pageUrl ).show();
			} else {
				$pageBtn.hide();
			}

			renderInfo( session );

			var html = '';
			var lastDay = '';

			for ( var i = 0; i < messages.length; i++ ) {
				var day = fmtDay( messages[ i ].ts );

				if ( day && day !== lastDay ) {
					lastDay = day;
					html += '<div class="tmb-msg-day">' + esc( day ) + '</div>';
				}

				html += messageRow( messages[ i ] );
				S.lastId = Math.max( S.lastId, parseInt( messages[ i ].id, 10 ) || 0 );
			}

			$body.html( html || '<p class="tmb-thread-nomsg">—</p>' );
			$body.scrollTop( $body[ 0 ].scrollHeight );

			$thread.attr( 'hidden', false );
			$empty.attr( 'hidden', true );

			$input.prop( 'disabled', false ).trigger( 'focus' );
		}

		function openThread( id ) {
			if ( S.loadingThread ) {
				return;
			}

			S.id = id;
			S.lastId = 0;
			S.loadingThread = true;

			$list.find( '.tmb-ses' ).removeClass( 'is-active' );
			$list.find( '.tmb-ses[data-id="' + id + '"]' ).addClass( 'is-active' ).removeClass( 'is-unread' ).find( '.tmb-ses-badge' ).remove();

			$empty.attr( 'hidden', true );
			$thread.attr( 'hidden', false );
			$body.html( '<p class="tmb-thread-nomsg">' + esc( I.loading || '…' ) + '</p>' );

			rest( '/admin/session/' + parseInt( id, 10 ), null, 'GET' )
				.done( function ( res ) {
					S.loadingThread = false;

					if ( ! res || ! res.session ) {
						return;
					}

					renderThread( res.session, res.messages || [] );
					updateCounters( res.counters );
				} )
				.fail( function ( msg ) {
					S.loadingThread = false;
					$body.html( '<p class="tmb-thread-nomsg tmb-inbox-error">' + esc( msg ) + '</p>' );
				} );
		}

		function refreshThread() {
			if ( ! S.id || S.loadingThread || document.hidden ) {
				return;
			}

			rest( '/admin/session/' + parseInt( S.id, 10 ), null, 'GET' )
				.done( function ( res ) {
					if ( ! res || ! res.messages ) {
						return;
					}

					var fresh = [];
					var i;

					for ( i = 0; i < res.messages.length; i++ ) {
						if ( ( parseInt( res.messages[ i ].id, 10 ) || 0 ) > S.lastId ) {
							fresh.push( res.messages[ i ] );
						}
					}

					if ( ! fresh.length ) {
						updateCounters( res.counters );
						return;
					}

					var html = '';

					for ( i = 0; i < fresh.length; i++ ) {
						html += messageRow( fresh[ i ] );
						S.lastId = Math.max( S.lastId, parseInt( fresh[ i ].id, 10 ) || 0 );
					}

					var nearBottom = $body[ 0 ].scrollHeight - $body.scrollTop() - $body.innerHeight() < 160;

					$body.find( '.tmb-thread-nomsg' ).remove();
					$body.append( html );

					if ( nearBottom ) {
						$body.scrollTop( $body[ 0 ].scrollHeight );
					}

					var hasVisitor = false;

					for ( i = 0; i < fresh.length; i++ ) {
						if ( 'visitor' === fresh[ i ].sender ) {
							hasVisitor = true;
						}
					}

					if ( hasVisitor ) {
						beep();
					}

					if ( res.session ) {
						S.status = res.session.status || S.status;
						$statusBtn.text( 'closed' === S.status ? ( I.reopenChat || 'باز کردن گفتگو' ) : ( I.closeChat || 'بستن گفتگو' ) );
					}

					updateCounters( res.counters );
				} )
				.fail( function () {} );
		}

		/* ---------- actions ---------- */

		$form.on( 'submit', function ( e ) {
			e.preventDefault();

			var text = $.trim( $input.val() || '' );

			if ( ! text || ! S.id ) {
				return;
			}

			$input.val( '' ).prop( 'disabled', true );
			$form.find( 'button[type="submit"]' ).prop( 'disabled', true ).text( I.sending || '…' );

			rest( '/admin/message', { session: S.id, message: text }, 'POST' )
				.done( function ( res ) {
					if ( res && res.message && res.message.id ) {
						$body.append( messageRow( res.message ) );
						S.lastId = Math.max( S.lastId, parseInt( res.message.id, 10 ) || 0 );
						$body.scrollTop( $body[ 0 ].scrollHeight );
					}

					if ( res && res.session ) {
						S.status = res.session.status || S.status;
						$name.text( res.session.name ? res.session.name : $name.text() );
					}

					loadList( true );
				} )
				.fail( function ( msg ) {
					window.alert( msg );
					$input.val( text );
				} )
				.always( function () {
					$input.prop( 'disabled', false ).trigger( 'focus' );
					$form.find( 'button[type="submit"]' ).prop( 'disabled', false ).text( I.send || 'ارسال پاسخ' );
				} );
		} );

		$input.on( 'keydown', function ( e ) {
			if ( 13 === e.keyCode && ! e.shiftKey ) {
				e.preventDefault();
				$form.trigger( 'submit' );
			}
		} );

		$statusBtn.on( 'click', function () {
			if ( ! S.id ) {
				return;
			}

			var next = 'closed' === S.status ? 'open' : 'closed';

			$statusBtn.prop( 'disabled', true );

			rest( '/admin/status', { session: S.id, status: next }, 'POST' )
				.done( function () {
					S.status = next;
					$statusBtn.text( 'closed' === next ? ( I.reopenChat || 'باز کردن گفتگو' ) : ( I.closeChat || 'بستن گفتگو' ) )
						.toggleClass( 'button-primary', 'closed' === next );
					loadList( true );
				} )
				.fail( function ( msg ) {
					window.alert( msg );
				} )
				.always( function () {
					$statusBtn.prop( 'disabled', false );
				} );
		} );

		$delBtn.on( 'click', function () {
			if ( ! S.id ) {
				return;
			}

			if ( ! window.confirm( I.confirmDelete || 'حذف شود؟' ) ) {
				return;
			}

			var id = S.id;

			$delBtn.prop( 'disabled', true );

			rest( '/admin/delete', { session: id }, 'POST' )
				.done( function ( res ) {
					S.id = 0;
					S.lastId = 0;

					$thread.attr( 'hidden', true );
					$empty.attr( 'hidden', false );

					updateCounters( res ? res.counters : null );
					loadList();
				} )
				.fail( function ( msg ) {
					window.alert( msg );
				} )
				.always( function () {
					$delBtn.prop( 'disabled', false );
				} );
		} );

		$list.on( 'click', '.tmb-ses', function () {
			openThread( parseInt( $( this ).data( 'id' ), 10 ) );
		} );

		$wrap.on( 'click', '.tmb-inbox-filter', function () {
			var $btn = $( this );

			$wrap.find( '.tmb-inbox-filter' ).removeClass( 'active' );
			$btn.addClass( 'active' );

			S.filter = String( $btn.data( 'filter' ) || '' );
			S.paged = 1;

			loadList();
		} );

		var searchTimer = null;

		$search.on( 'input', function () {
			window.clearTimeout( searchTimer );

			searchTimer = window.setTimeout( function () {
				S.search = $.trim( $search.val() || '' );
				S.paged = 1;
				loadList();
			}, 420 );
		} );

		$prev.on( 'click', function () {
			if ( S.paged > 1 ) {
				S.paged--;
				loadList();
			}
		} );

		$next.on( 'click', function () {
			if ( S.paged < S.pages ) {
				S.paged++;
				loadList();
			}
		} );

		document.addEventListener( 'visibilitychange', function () {
			if ( ! document.hidden ) {
				loadList( true );
				refreshThread();
			}
		} );

		/* ---------- start ---------- */

		loadList();

		S.timer = window.setInterval( function () {
			if ( document.hidden ) {
				return;
			}

			loadList( true );
			refreshThread();
		}, 10000 );

		/* open the conversation that the link asked for (?chat=12) */
		var wanted = 0;
		var match  = /[?&](?:chat|session)=(\d+)/.exec( window.location.search || '' );

		if ( match ) {
			wanted = parseInt( match[ 1 ], 10 );
		}

		if ( wanted ) {
			window.setTimeout( function () {
				openThread( wanted );
			}, 350 );
		}
	}

	/* ------------------------------------------------------------------
	 * go
	 * ---------------------------------------------------------------- */

	$( function () {
		if ( 1 === parseInt( DATA.inbox, 10 ) ) {
			initInbox();
		} else {
			initSettings();
		}
	} );
} )( jQuery );
