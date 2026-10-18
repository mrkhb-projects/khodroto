/**
 * Tamas Box - admin scripts (multi box)
 */
( function ( $ ) {
	'use strict';

	var DATA  = window.TMB_ADMIN || { icons: {}, hints: {}, i18n: {}, days: {} };
	var ICONS = DATA.icons || {};
	var OPT   = DATA.option || 'tmb_settings';

	function svg( key, cls ) {
		var ico = ICONS[ key ] || ICONS.link || { svg: '' };
		return '<svg class="' + ( cls || '' ) + '" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">' + ico.svg + '</svg>';
	}

	function brandColor( key ) {
		return ( ICONS[ key ] && ICONS[ key ].color ) || '#334155';
	}

	function esc( str ) {
		return $( '<div>' ).text( str == null ? '' : str ).html();
	}

	$( function () {

		var $boxes   = $( '#tmb-boxes' );
		var $preview = $( '#tmb-preview' );

		/* ============ main tabs ============ */
		var $tabs = $( '.tmb-tab' );

		function activate( hash ) {
			var $target = $( hash );
			if ( ! $target.length ) {
				return;
			}
			$tabs.removeClass( 'active' ).filter( '[href="' + hash + '"]' ).addClass( 'active' );
			$( '.tmb-wrap > form .tmb-panel' ).removeClass( 'active' );
			$target.addClass( 'active' );
			try {
				window.sessionStorage.setItem( 'tmb_tab', hash );
			} catch ( e ) {}
		}

		$tabs.on( 'click', function ( e ) {
			e.preventDefault();
			activate( $( this ).attr( 'href' ) );
		} );

		try {
			var saved = window.sessionStorage.getItem( 'tmb_tab' );
			if ( saved && $( saved ).length ) {
				activate( saved );
			}
		} catch ( e ) {}

		/* ============ colour pickers ============ */
		function initColors( $scope ) {
			$scope.find( '.tmb-color' ).each( function () {
				var $el = $( this );
				if ( $el.hasClass( 'wp-color-picker' ) ) {
					return;
				}
				$el.wpColorPicker( {
					change: function () {
						var self = this;
						window.setTimeout( function () {
							$( self ).trigger( 'change' );
							refreshAll();
						}, 40 );
					},
					clear: refreshAll
				} );
			} );
		}

		/* ============ box open / close ============ */
		$( document ).on( 'click', '.tmb-toggle-box', function () {
			$( this ).closest( '.tmb-box' ).toggleClass( 'tmb-open' );
		} );

		$( document ).on( 'click', '.tmb-box-head', function ( e ) {
			if ( $( e.target ).closest( 'button, label, input, .tmb-drag' ).length ) {
				return;
			}
			$( this ).closest( '.tmb-box' ).toggleClass( 'tmb-open' );
		} );

		/* ============ inner sub tabs ============ */
		$( document ).on( 'click', '.tmb-subtab', function ( e ) {
			e.preventDefault();
			var $t   = $( this );
			var sub  = $t.data( 'sub' );
			var $box = $t.closest( '.tmb-box' );

			$box.find( '> .tmb-box-body > .tmb-subtabs .tmb-subtab' ).removeClass( 'active' );
			$t.addClass( 'active' );
			$box.find( '> .tmb-box-body > .tmb-subpanel' ).removeClass( 'active' );
			$box.find( '> .tmb-box-body > .tmb-subpanel[data-sub="' + sub + '"]' ).addClass( 'active' );
		} );

		/* ============ position grid ============ */
		$( document ).on( 'click', '.tmb-poscell', function () {
			var $cell = $( this );
			var $box  = $cell.closest( '.tmb-box' );

			$box.find( '.tmb-poscell' ).removeClass( 'selected' );
			$cell.addClass( 'selected' );
			$box.find( '.tmb-position-input' ).val( $cell.data( 'pos' ) ).trigger( 'change' );

			refreshAll();
		} );

		/* ============ icon pickers ============ */
		$( document ).on( 'click', '.tmb-iconopt', function ( e ) {
			e.preventDefault();
			var $btn  = $( this );
			var $pick = $btn.closest( '.tmb-iconpick' );
			var key   = $btn.data( 'icon' );

			$pick.find( '.tmb-iconopt' ).removeClass( 'selected' );
			$btn.addClass( 'selected' );

			if ( $pick.hasClass( 'tmb-btn-iconpick' ) ) {
				$pick.closest( '.tmb-subpanel' ).find( '.tmb-btn-icon-input' ).val( key ).trigger( 'change' );
			} else {
				var $item = $btn.closest( '.tmb-item' );
				$item.find( '.tmb-item-icon-input' ).val( key );

				if ( ! $item.find( '.tmb-item-customcolor' ).is( ':checked' ) ) {
					var $color = $item.find( '.tmb-item-color' );
					if ( $color.hasClass( 'wp-color-picker' ) ) {
						$color.wpColorPicker( 'color', brandColor( key ) );
					} else {
						$color.val( brandColor( key ) );
					}
				}

				var $url = $item.find( '.tmb-item-url' );
				if ( ! $url.val() && DATA.hints && DATA.hints[ key ] ) {
					$url.attr( 'placeholder', DATA.hints[ key ] );
				}
			}

			refreshAll();
		} );

		/* ============ add / remove / duplicate box ============ */
		function nextBoxIndex() {
			var max = -1;
			$boxes.find( '> .tmb-box' ).each( function () {
				var i = parseInt( $( this ).data( 'bi' ), 10 );
				if ( ! isNaN( i ) && i > max ) {
					max = i;
				}
			} );
			return max + 1;
		}

		function nextBoxId() {
			var used = {};
			$boxes.find( '.tmb-box-id' ).each( function () {
				used[ $( this ).val() ] = true;
			} );
			var i = 1;
			while ( used[ 'box' + i ] ) {
				i++;
			}
			return 'box' + i;
		}

		$( '#tmb-add-box' ).on( 'click', function () {
			var tpl = $( '#tmpl-tmb-box' ).html();
			if ( ! tpl ) {
				return;
			}
			var bi   = nextBoxIndex();
			var id   = nextBoxId();
			var html = tpl.replace( /__b__/g, bi ).replace( /__id__/g, id );
			var $new = $( html );

			$new.find( '.tmb-box-id' ).val( id );
			$new.find( 'input[readonly]' ).val( id );

			$boxes.append( $new );
			$new.addClass( 'tmb-open' );
			initColors( $new );
			initSortables( $new );

			$( 'html, body' ).animate( { scrollTop: $new.offset().top - 80 }, 300 );
			refreshAll();
		} );

		$( document ).on( 'click', '.tmb-remove-box', function ( e ) {
			e.stopPropagation();
			if ( $boxes.find( '> .tmb-box' ).length <= 1 ) {
				window.alert( DATA.i18n.lastBox || 'At least one box is required.' );
				return;
			}
			if ( ! window.confirm( DATA.i18n.confirmDeleteBox || 'Delete this box?' ) ) {
				return;
			}
			$( this ).closest( '.tmb-box' ).slideUp( 170, function () {
				$( this ).remove();
				refreshAll();
			} );
		} );

		$( document ).on( 'click', '.tmb-dup-box', function ( e ) {
			e.stopPropagation();

			var $src = $( this ).closest( '.tmb-box' );
			var bi   = nextBoxIndex();
			var id   = nextBoxId();

			/* snapshot current values so they survive the clone */
			$src.find( 'input, select, textarea' ).each( function () {
				var $f = $( this );
				if ( $f.is( ':checkbox' ) || $f.is( ':radio' ) ) {
					if ( $f.is( ':checked' ) ) {
						$f.attr( 'checked', 'checked' );
					} else {
						$f.removeAttr( 'checked' );
					}
				} else if ( $f.is( 'select' ) ) {
					$f.find( 'option' ).removeAttr( 'selected' );
					$f.find( 'option:selected' ).attr( 'selected', 'selected' );
				} else {
					$f.attr( 'value', $f.val() );
				}
			} );

			var oldBi = $src.data( 'bi' );
			var html  = $src.prop( 'outerHTML' );

			/* strip colour picker wrappers so they can be re-initialised */
			var $tmp = $( '<div>' ).html( html );
			$tmp.find( '.wp-picker-container' ).each( function () {
				var $w = $( this );
				var $i = $w.find( 'input.tmb-color' ).first();
				$i.removeClass( 'wp-color-picker' ).removeAttr( 'style' ).attr( 'type', 'text' );
				$w.replaceWith( $i );
			} );
			html = $tmp.html();

			var re = new RegExp( '\\[boxes\\]\\[' + oldBi + '\\]', 'g' );
			html   = html.replace( re, '[boxes][' + bi + ']' );

			var $new = $( html );
			$new.attr( 'data-bi', bi ).data( 'bi', bi );
			$new.find( '.tmb-box-id' ).val( id );
			$new.find( 'input[readonly]' ).val( id );

			var name = $new.find( '.tmb-name-input' ).val() || '';
			$new.find( '.tmb-name-input' ).val( name + ' (کپی)' );

			$src.after( $new );
			$new.addClass( 'tmb-open' );
			initColors( $new );
			initSortables( $new );
			refreshAll();
		} );

		/* ============ items ============ */
		$( document ).on( 'click', '.tmb-add-item', function () {
			var tpl = $( '#tmpl-tmb-item' ).html();
			if ( ! tpl ) {
				return;
			}
			var $box  = $( this ).closest( '.tmb-box' );
			var $list = $box.find( '.tmb-items-list' );
			var bi    = $box.data( 'bi' );

			var max = -1;
			$list.find( '> .tmb-item' ).each( function () {
				var i = parseInt( $( this ).data( 'index' ), 10 );
				if ( ! isNaN( i ) && i > max ) {
					max = i;
				}
			} );

			var html = tpl.replace( /__b__/g, bi ).replace( /__i__/g, max + 1 );
			var $new = $( html );

			$list.append( $new );
			$new.addClass( 'tmb-open' );
			initColors( $new );
			$new.find( '.tmb-item-label' ).trigger( 'focus' );
			refreshAll();
		} );

		function setItemOpen( $item, open ) {
			$item.toggleClass( 'tmb-open', !! open );
			$item.find( '.tmb-item-head' ).attr( 'aria-expanded', open ? 'true' : 'false' );
			if ( open ) {
				// Ensure colour pickers work after the body becomes visible.
				window.setTimeout( function () {
					initColors( $item );
				}, 30 );
			}
		}

		function toggleItem( $item ) {
			setItemOpen( $item, ! $item.hasClass( 'tmb-open' ) );
		}

		$( document ).on( 'click', '.tmb-toggle-item', function ( e ) {
			e.preventDefault();
			e.stopPropagation();
			toggleItem( $( this ).closest( '.tmb-item' ) );
		} );

		/* Clicking the whole item header opens the editor (except controls). */
		$( document ).on( 'click', '.tmb-item-head', function ( e ) {
			if ( $( e.target ).closest( 'button, label, input, a, .tmb-drag, .wp-picker-container' ).length ) {
				return;
			}
			toggleItem( $( this ).closest( '.tmb-item' ) );
		} );

		$( document ).on( 'keydown', '.tmb-item-head', function ( e ) {
			if ( e.key === 'Enter' || e.key === ' ' ) {
				e.preventDefault();
				toggleItem( $( this ).closest( '.tmb-item' ) );
			}
		} );

		/* One-click colour presets for the floating button. */
		$( document ).on( 'click', '.tmb-color-preset', function ( e ) {
			e.preventDefault();
			var $btn = $( this );
			var $box = $btn.closest( '.tmb-box' );
			var c1   = $btn.data( 'c1' );
			var c2   = $btn.data( 'c2' );
			var fg   = $btn.data( 'fg' );

			function setColor( selector, val ) {
				var $input = $box.find( selector ).first();
				if ( ! $input.length ) {
					return;
				}
				$input.val( val );
				if ( $input.hasClass( 'wp-color-picker' ) || $input.next( '.wp-picker-container' ).length ) {
					try {
						$input.wpColorPicker( 'color', val );
					} catch ( err ) {
						$input.trigger( 'change' );
					}
				} else {
					$input.trigger( 'change' );
				}
			}

			setColor( 'input.tmb-btn-c1, input[name*="[btn_color_1]"]', c1 );
			setColor( 'input.tmb-btn-c2, input[name*="[btn_color_2]"]', c2 );
			setColor( 'input.tmb-btn-fg, input[name*="[btn_icon_color]"]', fg );
			setColor( 'input.tmb-btn-pulse, input[name*="[btn_pulse_color]"]', c1 );
			refreshAll();
		} );

		$( document ).on( 'click', '.tmb-remove-item', function ( e ) {
			e.preventDefault();
			e.stopPropagation();
			if ( ! window.confirm( DATA.i18n.confirmDelete || 'Delete?' ) ) {
				return;
			}
			$( this ).closest( '.tmb-item' ).slideUp( 160, function () {
				$( this ).remove();
				refreshAll();
			} );
		} );

		/* ============ schedule ranges ============ */
		$( document ).on( 'click', '.tmb-add-range', function () {
			var tpl = $( '#tmpl-tmb-range' ).html();
			if ( ! tpl ) {
				return;
			}
			var $box  = $( this ).closest( '.tmb-box' );
			var $list = $box.find( '.tmb-ranges-list' );
			var bi    = $box.data( 'bi' );

			var max = -1;
			$list.find( '> .tmb-range-row' ).each( function () {
				var i = parseInt( $( this ).data( 'ri' ), 10 );
				if ( ! isNaN( i ) && i > max ) {
					max = i;
				}
			} );

			var html = tpl.replace( /__b__/g, bi ).replace( /__r__/g, max + 1 );
			$list.append( $( html ) );
			syncChips();
		} );

		$( document ).on( 'click', '.tmb-remove-range', function () {
			$( this ).closest( '.tmb-range-row' ).slideUp( 150, function () {
				$( this ).remove();
			} );
		} );

		/* ============ conditional fields ============ */
		function syncConditionals( $scope ) {
			$scope = $scope || $( document );

			$scope.find( '.tmb-user-mode' ).each( function () {
				var $sel = $( this );
				$sel.closest( '.tmb-grid-2' ).find( '.tmb-roles-field' ).toggleClass( 'is-hidden', 'roles' !== $sel.val() );
			} );

			$scope.find( '.tmb-sched-toggle' ).each( function () {
				var $t = $( this );
				$t.closest( '.tmb-subpanel' ).find( '.tmb-sched-fields' ).toggleClass( 'is-hidden', ! $t.is( ':checked' ) );
			} );

			$scope.find( '.tmb-box' ).addBack( '.tmb-box' ).each( function () {
				var $b   = $( this );
				var mode = $b.find( '.tmb-mode-radio:checked' ).val() || 'all';
				$b.find( '.tmb-rules-show' ).toggleClass( 'is-dim', 'all' === mode );
			} );
		}

		$( document ).on( 'change', '.tmb-user-mode, .tmb-sched-toggle, .tmb-mode-radio', function () {
			syncConditionals( $( this ).closest( '.tmb-box' ) );
			refreshAll();
		} );

		$( document ).on( 'change', '.tmb-radio-card input[type="radio"]', function () {
			var $card = $( this ).closest( '.tmb-radio-card' );
			$card.siblings().removeClass( 'selected' );
			$card.addClass( 'selected' );
		} );

		function syncChips() {
			$( '.tmb-checkchip' ).each( function () {
				var $c = $( this );
				$c.toggleClass( 'is-checked', $c.find( 'input' ).is( ':checked' ) );
			} );
		}
		$( document ).on( 'change', '.tmb-checkchip input', syncChips );

		/* ============ header summaries ============ */
		function refreshHeads() {
			$boxes.find( '> .tmb-box' ).each( function () {
				var $b = $( this );

				var name  = $b.find( '.tmb-name-input' ).val() || DATA.i18n.newBox;
				var icon  = $b.find( '.tmb-btn-icon-input' ).val() || 'chat';
				var c1    = $b.find( 'input[name*="[btn_color_1]"]' ).val() || '#c99a5b';
				var c2    = $b.find( 'input[name*="[btn_color_2]"]' ).val() || c1;
				var pos   = $b.find( '.tmb-position-input' ).val() || 'bottom-right';
				var count = $b.find( '.tmb-items-list > .tmb-item' ).length;
				var on    = $b.find( '.tmb-box-enabled' ).is( ':checked' );
				var sched = $b.find( '.tmb-sched-toggle' ).is( ':checked' );

				$b.find( '.tmb-box-name' ).text( name );
				$b.find( '.tmb-box-swatch' )
					.css( 'background', 'linear-gradient(135deg,' + c1 + ',' + c2 + ')' )
					.html( svg( icon ) );

				var posLabel = $b.find( '.tmb-poscell[data-pos="' + pos + '"] .tmb-poslabel' ).text() || pos;
				$b.find( '.tmb-chip-pos' ).text( posLabel );
				$b.find( '.tmb-chip-count' ).text( count + ' آیتم' );

				var $time = $b.find( '.tmb-chip-time' );
				if ( sched ) {
					if ( ! $time.length ) {
						$b.find( '.tmb-box-meta' ).append( '<span class="tmb-chip-time">⏰ زمان‌بندی فعال</span>' );
					}
				} else {
					$time.remove();
				}

				$b.toggleClass( 'is-off', ! on );

				/* item heads */
				$b.find( '.tmb-item' ).each( function () {
					var $i     = $( this );
					var label  = $i.find( '.tmb-item-label' ).val() || DATA.i18n.untitled;
					var sub    = $i.find( '.tmb-item-sub' ).val() || '';
					var key    = $i.find( '.tmb-item-icon-input' ).val() || 'link';
					var custom = $i.find( '.tmb-item-customcolor' ).is( ':checked' );
					var color  = custom ? ( $i.find( '.tmb-item-color' ).val() || brandColor( key ) ) : brandColor( key );
					var hint   = sub ? esc( sub ) : 'کلیک برای ویرایش';

					$i.find( '.tmb-item-title' ).html( esc( label ) + '<small>' + hint + '</small>' );
					$i.find( '.tmb-item-icon' ).css( 'background', color ).html( svg( key ) );
					$i.toggleClass( 'is-off', ! $i.find( '.tmb-item-enabled' ).is( ':checked' ) );
					$i.find( '.tmb-item-head' ).attr( 'aria-expanded', $i.hasClass( 'tmb-open' ) ? 'true' : 'false' );
				} );

				/* live mini button in design tab */
				var text = $b.find( 'input[name*="[btn_text]"]' ).val() || 'تماس با ما';
				var icon = $b.find( '.tmb-btn-icon-input' ).val() || 'chat';
				var fg   = $b.find( 'input[name*="[btn_icon_color]"]' ).val() || '#ffffff';
				$b.find( '[data-live-btn]' ).each( function () {
					$( this )
						.css( {
							background: 'linear-gradient(135deg,' + c1 + ',' + c2 + ')',
							color: fg
						} )
						.html( svg( icon ) + '<span>' + esc( text ) + '</span>' );
				} );
			} );
		}

		/* ============ live preview ============ */
		function boxVal( $b, key, def ) {
			var $f = $b.find( '[name*="[' + key + ']"]' ).not( '[type="checkbox"][name*="[]"]' ).first();
			if ( ! $f.length ) {
				return def;
			}
			if ( $f.attr( 'type' ) === 'checkbox' ) {
				return $f.is( ':checked' ) ? 1 : 0;
			}
			return $f.val();
		}

		function shapeRadius( shape ) {
			switch ( shape ) {
				case 'rounded': return '12px';
				case 'square':  return '0';
				case 'plain':   return '0';
				default:        return '50%';
			}
		}

		var pvOpenId = null;

		function renderPreview() {
			if ( ! $preview.length ) {
				return;
			}

			var mobile = $preview.hasClass( 'mobile' );
			var html   = '';
			var stacks = {};

			$boxes.find( '> .tmb-box' ).each( function () {
				var $b = $( this );
				if ( ! $b.find( '.tmb-box-enabled' ).is( ':checked' ) ) {
					return;
				}

				var id   = $b.find( '.tmb-box-id' ).val();
				var pos  = boxVal( $b, 'position', 'bottom-right' );
				var size = Math.max( 26, Math.round( parseInt( boxVal( $b, 'btn_size', 60 ), 10 ) * 0.62 ) );
				var rad  = parseInt( boxVal( $b, 'btn_radius', 50 ), 10 );
				var c1   = boxVal( $b, 'btn_color_1', '#c99a5b' );
				var c2   = boxVal( $b, 'btn_color_2', c1 ) || c1;
				var fg   = boxVal( $b, 'btn_icon_color', '#fff' );
				var icon = boxVal( $b, 'btn_icon', 'chat' );
				var text = boxVal( $b, 'btn_text', '' );
				var showText = parseInt( boxVal( $b, 'btn_show_text', 1 ), 10 );

				stacks[ pos ] = stacks[ pos ] || 0;
				var stackIdx  = stacks[ pos ];
				stacks[ pos ]++;

				var gap  = ( size + 10 ) * stackIdx;
				var edge = 14;

				var css = 'width:' + ( showText && text ? 'auto' : size + 'px' ) + ';min-width:' + size + 'px;height:' + size + 'px;' +
					'padding:' + ( showText && text ? '0 10px' : '0' ) + ';' +
					'border-radius:' + ( showText && text ? '999px' : rad + '%' ) + ';' +
					'background:linear-gradient(135deg,' + c1 + ',' + c2 + ');color:' + fg + ';font-size:10px;';

				if ( mobile ) {
					/* on mobile every button keeps its corner but the panel is a sheet */
					css += posCss( pos, edge, gap );
				} else {
					css += posCss( pos, edge, gap );
				}

				html += '<button type="button" class="pv-btn" data-pvid="' + esc( id ) + '" style="' + css + '">' +
					svg( icon ) + ( showText && text ? '<span>' + esc( text ) + '</span>' : '' ) +
					'</button>';

				/* panel */
				if ( pvOpenId === id ) {
					html += renderPanel( $b, pos, size, edge, gap, mobile );
				}
			} );

			if ( ! html ) {
				html = '<div class="pv-empty">هیچ باکس فعالی وجود ندارد</div>';
			}

			$preview.html( html );
		}

		function posCss( pos, edge, gap ) {
			var css = '';
			switch ( pos ) {
				case 'top-left':
					css = 'top:' + ( edge + gap ) + 'px;left:' + edge + 'px;';
					break;
				case 'top-center':
					css = 'top:' + ( edge + gap ) + 'px;left:50%;transform:translateX(-50%);';
					break;
				case 'top-right':
					css = 'top:' + ( edge + gap ) + 'px;right:' + edge + 'px;';
					break;
				case 'middle-left':
					css = 'top:50%;left:' + edge + 'px;transform:translateY(-50%) translateY(' + gap + 'px);';
					break;
				case 'middle-right':
					css = 'top:50%;right:' + edge + 'px;transform:translateY(-50%) translateY(' + gap + 'px);';
					break;
				case 'bottom-left':
					css = 'bottom:' + ( edge + gap ) + 'px;left:' + edge + 'px;';
					break;
				case 'bottom-center':
					css = 'bottom:' + ( edge + gap ) + 'px;left:50%;transform:translateX(-50%);';
					break;
				default:
					css = 'bottom:' + ( edge + gap ) + 'px;right:' + edge + 'px;';
			}
			return css;
		}

		function renderPanel( $b, pos, size, edge, gap, mobile ) {
			var pRadius  = parseInt( boxVal( $b, 'panel_radius', 18 ), 10 );
			var iconSize = Math.max( 16, Math.round( parseInt( boxVal( $b, 'icon_size', 42 ), 10 ) * 0.6 ) );
			var shape    = boxVal( $b, 'icon_shape', 'circle' );
			var style    = boxVal( $b, 'item_style', 'row' );
			var brand    = parseInt( boxVal( $b, 'use_brand_colors', 1 ), 10 );

			var panelCss;
			if ( mobile ) {
				panelCss = 'left:0;right:0;bottom:0;width:100%;border-radius:' + pRadius + 'px ' + pRadius + 'px 0 0;';
			} else {
				var w = Math.min( parseInt( boxVal( $b, 'panel_width', 340 ), 10 ), 250 );
				panelCss = 'width:' + w + 'px;max-width:calc(100% - 28px);border-radius:' + pRadius + 'px;';

				var offset = edge + size + 10 + gap;
				if ( 0 === pos.indexOf( 'top' ) ) {
					panelCss += 'top:' + offset + 'px;';
				} else if ( 0 === pos.indexOf( 'middle' ) ) {
					panelCss += 'top:50%;transform:translateY(-50%);';
				} else {
					panelCss += 'bottom:' + offset + 'px;';
				}

				if ( pos.indexOf( 'left' ) > -1 ) {
					panelCss += 'left:' + edge + 'px;';
				} else if ( pos.indexOf( 'center' ) > -1 ) {
					panelCss += 'left:50%;transform:translateX(-50%);';
				} else {
					panelCss += 'right:' + edge + 'px;';
				}
			}

			panelCss += 'background:' + boxVal( $b, 'panel_bg', '#fff' ) + ';color:' + boxVal( $b, 'panel_text', '#1f2937' ) + ';';

			var head = '';
			if ( parseInt( boxVal( $b, 'panel_show_head', 1 ), 10 ) ) {
				head = '<div class="pv-head" style="background:' + boxVal( $b, 'panel_head_bg', '#fff' ) + ';color:' + boxVal( $b, 'panel_head_text', '#1f2937' ) + ';border-color:' + boxVal( $b, 'item_divider', '#eee' ) + '">' +
					'<strong>' + esc( boxVal( $b, 'panel_title', '' ) ) + '</strong>' +
					'<span style="color:' + boxVal( $b, 'panel_sub_text', '#6b7280' ) + '">' + esc( boxVal( $b, 'panel_subtitle', '' ) ) + '</span>' +
					'</div>';
			}

			var closeStyle = boxVal( $b, 'close_style', 'outline' );
			var closeColor = boxVal( $b, 'close_color', '#e11d48' );
			var closeCss   = 'solid' === closeStyle
				? 'background:' + closeColor + ';color:#fff;border:0;'
				: 'background:transparent;color:' + closeColor + ';border:1.5px solid ' + closeColor + ';';
			var closeHtml  = 'icon' === closeStyle
				? ''
				: '<button type="button" class="pv-close" style="' + closeCss + '">✕ <span>' + esc( boxVal( $b, 'close_text', 'بستن' ) ) + '</span></button>';

			var items = '';
			$b.find( '.tmb-items-list > .tmb-item' ).each( function () {
				var $i = $( this );
				if ( ! $i.find( '.tmb-item-enabled' ).is( ':checked' ) ) {
					return;
				}
				var key    = $i.find( '.tmb-item-icon-input' ).val() || 'link';
				var custom = $i.find( '.tmb-item-customcolor' ).is( ':checked' );
				var color  = custom
					? ( $i.find( '.tmb-item-color' ).val() || brandColor( key ) )
					: ( brand ? brandColor( key ) : ( $i.find( '.tmb-item-color' ).val() || brandColor( key ) ) );

				var badge = 'width:' + iconSize + 'px;height:' + iconSize + 'px;border-radius:' + shapeRadius( shape ) + ';' +
					( 'plain' === shape ? 'background:transparent;color:' + color + ';' : 'background:' + color + ';color:#fff;' );

				items += '<a class="pv-item" href="#" onclick="return false" style="background:' + boxVal( $b, 'item_bg', '#fff' ) + ';color:' + boxVal( $b, 'item_text', '#1f2937' ) + ';border-color:' + boxVal( $b, 'item_divider', '#eee' ) + '">' +
					'<span>' + esc( $i.find( '.tmb-item-label' ).val() || '—' ) + '</span>' +
					'<span class="pv-badge" style="' + badge + '">' + svg( key ) + '</span>' +
					'</a>';
			} );

			if ( ! items ) {
				items = '<div class="pv-empty">آیتمی اضافه نشده</div>';
			}

			var gridCss = 'grid' === style ? 'display:grid;grid-template-columns:repeat(3,1fr);gap:5px;padding:8px;' : '';

			return '<div class="pv-panel is-open" style="' + panelCss + '" dir="rtl">' +
				head + closeHtml +
				'<div class="pv-items" style="' + gridCss + '">' + items + '</div>' +
				'</div>';
		}

		$( document ).on( 'click', '.tmb-preview .pv-btn', function () {
			var id = $( this ).data( 'pvid' );
			pvOpenId = ( pvOpenId === id ) ? null : id;
			renderPreview();
		} );

		$( document ).on( 'click', '.tmb-preview .pv-close', function () {
			pvOpenId = null;
			renderPreview();
		} );

		$( '.tmb-pv' ).on( 'click', function () {
			var mode = $( this ).data( 'mode' );
			$( '.tmb-pv' ).removeClass( 'active' );
			$( this ).addClass( 'active' );
			$preview.removeClass( 'desktop mobile' ).addClass( mode );
			renderPreview();
		} );

		/* ============ sortables ============ */
		function initSortables( $scope ) {
			$scope = $scope || $( document );

			$scope.find( '.tmb-items-list' ).each( function () {
				var $l = $( this );
				if ( $l.data( 'ui-sortable' ) ) {
					return;
				}
				$l.sortable( {
					handle: '.tmb-drag',
					placeholder: 'tmb-placeholder',
					forcePlaceholderSize: true,
					axis: 'y',
					update: refreshAll
				} );
			} );
		}

		if ( $boxes.length && $.fn.sortable ) {
			$boxes.sortable( {
				handle: '.tmb-box-drag',
				placeholder: 'tmb-placeholder',
				forcePlaceholderSize: true,
				axis: 'y',
				update: refreshAll
			} );
		}

		/* ============ glue ============ */
		function refreshAll() {
			refreshHeads();
			renderPreview();
		}

		$( document ).on( 'input change', '#tmb-boxes input, #tmb-boxes select, #tmb-boxes textarea', function () {
			refreshAll();
		} );

		initColors( $( '.tmb-wrap' ) );
		initSortables( $( document ) );
		syncConditionals();
		syncChips();
		refreshAll();

		/* open the first box by default */
		$boxes.find( '> .tmb-box' ).first().addClass( 'tmb-open' );

		/* unsaved changes warning */
		var dirty = false;
		$( '#tmb-form' ).on( 'change input', function () {
			dirty = true;
		} );
		$( '#tmb-form' ).on( 'submit', function () {
			dirty = false;
		} );
		$( window ).on( 'beforeunload', function () {
			if ( dirty ) {
				return 'تغییرات ذخیره نشده‌اند.';
			}
		} );
	} );
} )( jQuery );
