<?php
/**
 * Frontend rendering (multi box).
 *
 * @package Tamas_Box
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class TMB_Frontend {

	/**
	 * Global settings.
	 *
	 * @var array
	 */
	protected $s;

	/**
	 * Boxes visible on this request.
	 *
	 * @var array|null
	 */
	protected $active = null;

	public function __construct() {
		$this->s = TMB_Settings::get();

		add_action( 'wp_enqueue_scripts', array( $this, 'assets' ) );
		add_action( 'wp_footer', array( $this, 'render' ), 99 );

		add_shortcode( 'tamas_box', array( $this, 'shortcode_box' ) );
		add_shortcode( 'tamas_button', array( $this, 'shortcode_button' ) );
	}

	/**
	 * Boxes that pass every visibility rule.
	 *
	 * @return array
	 */
	public function active_boxes() {
		if ( null !== $this->active ) {
			return $this->active;
		}

		$this->active = self::visible_boxes( $this->s );

		return $this->active;
	}

	/**
	 * Static, cached version of active_boxes().
	 *
	 * Other modules (the live chat for example) need to know which boxes are
	 * visible during wp_enqueue_scripts, before the footer markup is built.
	 *
	 * @param array|null $settings Optional settings array.
	 * @return array
	 */
	public static function visible_boxes( $settings = null ) {
		static $cache = null;

		if ( null !== $cache ) {
			return $cache;
		}

		$cache = array();

		if ( null === $settings ) {
			$settings = TMB_Settings::get();
		}

		if ( ! TMB_Visibility::is_active( $settings ) ) {
			return $cache;
		}

		foreach ( (array) $settings['boxes'] as $box ) {
			if ( is_array( $box ) && TMB_Visibility::is_box_visible( $box, $settings ) ) {
				$cache[] = $box;
			}
		}

		return $cache;
	}

	/**
	 * Anything to render?
	 *
	 * @return bool
	 */
	public function should_render() {
		$boxes = $this->active_boxes();
		return ! empty( $boxes );
	}

	/**
	 * Enqueue assets.
	 */
	public function assets() {
		if ( ! $this->should_render() ) {
			return;
		}

		wp_enqueue_style( 'tmb-frontend', TMB_URL . 'assets/css/frontend.css', array(), TMB_VERSION );
		wp_add_inline_style( 'tmb-frontend', $this->inline_css() );

		wp_enqueue_script( 'tmb-frontend', TMB_URL . 'assets/js/frontend.js', array(), TMB_VERSION, true );
		wp_localize_script(
			'tmb-frontend',
			'TMB_DATA',
			array(
				'openOnLoad'    => (int) $this->s['open_on_load'],
				'openDelay'     => (int) $this->s['open_delay'],
				'closeOnScroll' => (int) $this->s['close_on_scroll'],
				'remember'      => (int) $this->s['remember_state'],
			)
		);
	}

	/**
	 * Global CSS variables + one scoped block per box.
	 *
	 * @return string
	 */
	public function inline_css() {
		$s    = $this->s;
		$font = trim( $s['font_family'] );
		if ( '' === $font ) {
			$font = 'inherit';
		}

		$css  = ':root{';
		$css .= '--tmb-z:' . intval( $s['z_index'] ) . ';';
		$css .= '--tmb-font:' . $font . ';';
		$css .= '--tmb-overlay:' . $s['overlay_color'] . ';';
		$css .= '}';

		if ( empty( $s['overlay_desktop'] ) ) {
			$css .= '@media(min-width:769px){.tmb-overlay{display:none!important}}';
		}

		foreach ( $this->active_boxes() as $box ) {
			$sel = '#tmb-' . $box['id'];

			$css .= $sel . '{';
			$css .= '--tmb-btn-1:' . $box['btn_color_1'] . ';';
			$css .= '--tmb-btn-2:' . ( $box['btn_color_2'] ? $box['btn_color_2'] : $box['btn_color_1'] ) . ';';
			$css .= '--tmb-btn-fg:' . $box['btn_icon_color'] . ';';
			$css .= '--tmb-btn-size:' . intval( $box['btn_size'] ) . 'px;';
			$css .= '--tmb-btn-radius:' . intval( $box['btn_radius'] ) . '%;';
			$css .= '--tmb-btn-x:' . intval( $box['offset_x'] ) . 'px;';
			$css .= '--tmb-btn-y:' . intval( $box['offset_y'] ) . 'px;';
			$mob_y = isset( $box['mobile_offset_y'] ) ? intval( $box['mobile_offset_y'] ) : 88;
			$css .= '--tmb-btn-y-mobile:' . $mob_y . 'px;';
			$css .= '--tmb-pulse:' . $box['btn_pulse_color'] . ';';
			$css .= '--tmb-panel-bg:' . $box['panel_bg'] . ';';
			$css .= '--tmb-panel-text:' . $box['panel_text'] . ';';
			$css .= '--tmb-panel-sub:' . $box['panel_sub_text'] . ';';
			$css .= '--tmb-head-bg:' . $box['panel_head_bg'] . ';';
			$css .= '--tmb-head-text:' . $box['panel_head_text'] . ';';
			$css .= '--tmb-panel-radius:' . intval( $box['panel_radius'] ) . 'px;';
			$css .= '--tmb-panel-w:' . intval( $box['panel_width'] ) . 'px;';
			$css .= '--tmb-item-bg:' . $box['item_bg'] . ';';
			$css .= '--tmb-item-hover:' . $box['item_hover_bg'] . ';';
			$css .= '--tmb-item-divider:' . $box['item_divider'] . ';';
			$css .= '--tmb-item-text:' . $box['item_text'] . ';';
			$css .= '--tmb-item-sub:' . $box['item_sub_text'] . ';';
			$css .= '--tmb-icon-size:' . intval( $box['icon_size'] ) . 'px;';
			$css .= '--tmb-close:' . $box['close_color'] . ';';
			$css .= '}';

			if ( empty( $box['show_desktop'] ) ) {
				$css .= '@media(min-width:769px){' . $sel . '{display:none!important}}';
			}
			if ( empty( $box['show_mobile'] ) ) {
				$css .= '@media(max-width:768px){' . $sel . '{display:none!important}}';
			}
		}

		if ( ! empty( $s['custom_css'] ) ) {
			$css .= "\n" . $s['custom_css'];
		}

		return $css;
	}

	/**
	 * Markup for one contact item.
	 *
	 * @param array $item Item.
	 * @param array $box  Parent box.
	 * @return string
	 */
	protected function item_html( $item, $box ) {
		$action  = ( isset( $item['action'] ) && 'chat' === $item['action'] ) ? 'chat' : 'link';
		$is_chat = ( 'chat' === $action && class_exists( 'TMB_Chat' ) && TMB_Chat::enabled() );

		if ( empty( $item['enabled'] ) || ( '' === $item['url'] && ! $is_chat ) ) {
			return '';
		}

		$url = $is_chat ? '#tmb-chat' : $item['url'];

		$color = ! empty( $item['custom_color'] )
			? $item['color']
			: ( ! empty( $box['use_brand_colors'] ) ? TMB_Icons::color( $item['icon'] ) : $item['color'] );

		$classes = array( 'tmb-item' );
		if ( 'desktop' === $item['device'] ) {
			$classes[] = 'tmb-only-desktop';
		} elseif ( 'mobile' === $item['device'] ) {
			$classes[] = 'tmb-only-mobile';
		}

		$is_tel = ( 0 === stripos( $url, 'tel:' ) );
		if ( $is_tel ) {
			$classes[] = 'tmb-is-tel';
		}
		if ( $is_chat ) {
			$classes[] = 'tmb-is-chat';
		}

		$rel    = array();
		$target = '';
		if ( ! empty( $item['new_tab'] ) && ! $is_tel && ! $is_chat ) {
			$target = ' target="_blank"';
			$rel[]  = 'noopener';
			$rel[]  = 'noreferrer';
		}
		if ( ! empty( $item['nofollow'] ) ) {
			$rel[] = 'nofollow';
		}
		$rel_attr = $rel ? ' rel="' . esc_attr( implode( ' ', array_unique( $rel ) ) ) . '"' : '';

		$html  = '<a class="' . esc_attr( implode( ' ', $classes ) ) . '" href="' . esc_attr( $url ) . '"' . $target . $rel_attr;
		$html .= ' data-tmb-type="' . esc_attr( $item['icon'] ) . '"';
		if ( $is_chat ) {
			$html .= ' data-tmb-action="chat" role="button" aria-haspopup="dialog"';
		}
		$html .= '>';

		$html .= '<span class="tmb-item-text">';
		$html .= '<span class="tmb-item-label">' . esc_html( $item['label'] ) . '</span>';
		if ( ! empty( $item['sublabel'] ) ) {
			$html .= '<span class="tmb-item-sub">' . esc_html( $item['sublabel'] ) . '</span>';
		}
		$html .= '</span>';

		if ( $is_chat ) {
			$html .= '<span class="tmb-chat-unread" data-tmb-chat-unread hidden>0</span>';
		}

		$html .= '<span class="tmb-item-badge tmb-shape-' . esc_attr( $box['icon_shape'] ) . '" style="--tmb-brand:' . esc_attr( $color ) . '">';
		$html .= TMB_Icons::svg( $item['icon'], 'tmb-ico' );
		$html .= '</span>';

		$html .= '</a>';

		return $html;
	}

	/**
	 * Markup for one full box.
	 *
	 * @param array $box Box settings.
	 * @return string
	 */
	public function box_markup( $box ) {
		$s   = $this->s;
		$dir = 'auto' === $s['direction'] ? ( is_rtl() ? 'rtl' : 'ltr' ) : $s['direction'];

		$classes = array(
			'tmb-root',
			'tmb-pos-' . $box['position'],
			'tmb-anim-' . $box['animation'],
			'tmb-style-' . $box['item_style'],
		);
		if ( ! empty( $box['btn_shadow'] ) ) {
			$classes[] = 'tmb-has-shadow';
		}
		if ( ! empty( $box['btn_pulse'] ) ) {
			$classes[] = 'tmb-has-pulse';
		}

		$items_html = '';
		foreach ( $box['items'] as $item ) {
			$items_html .= $this->item_html( $item, $box );
		}

		$id       = esc_attr( $box['id'] );
		$panel_id = 'tmb-panel-' . $id;

		ob_start();
		?>
		<div class="<?php echo esc_attr( implode( ' ', $classes ) ); ?>" id="tmb-<?php echo $id; // phpcs:ignore ?>" data-tmb-box="<?php echo $id; // phpcs:ignore ?>" dir="<?php echo esc_attr( $dir ); ?>">

			<div class="tmb-overlay" data-tmb-overlay hidden></div>

			<div class="tmb-panel" id="<?php echo esc_attr( $panel_id ); ?>" role="dialog" aria-modal="true" hidden>
				<div class="tmb-handle" aria-hidden="true"></div>

				<?php if ( ! empty( $box['panel_show_head'] ) ) : ?>
					<div class="tmb-head">
						<div class="tmb-head-texts">
							<strong class="tmb-head-title"><?php echo esc_html( $box['panel_title'] ); ?></strong>
							<?php if ( ! empty( $box['panel_subtitle'] ) ) : ?>
								<span class="tmb-head-sub"><?php echo esc_html( $box['panel_subtitle'] ); ?></span>
							<?php endif; ?>
						</div>
						<button type="button" class="tmb-head-close" aria-label="<?php esc_attr_e( 'بستن', 'tamas-box' ); ?>">
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
						</button>
					</div>
				<?php endif; ?>

				<button type="button" class="tmb-close tmb-close-<?php echo esc_attr( $box['close_style'] ); ?>">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
					<?php if ( 'icon' !== $box['close_style'] ) : ?>
						<span><?php echo esc_html( $box['close_text'] ); ?></span>
					<?php endif; ?>
				</button>

				<div class="tmb-items">
					<?php echo $items_html; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
				</div>
			</div>

			<button type="button" class="tmb-btn" aria-expanded="false" aria-controls="<?php echo esc_attr( $panel_id ); ?>"
				<?php if ( ! empty( $box['btn_show_tooltip'] ) && ! empty( $box['btn_tooltip'] ) ) : ?>
					data-tooltip="<?php echo esc_attr( $box['btn_tooltip'] ); ?>"
				<?php endif; ?>
				aria-label="<?php echo esc_attr( $box['btn_tooltip'] ? $box['btn_tooltip'] : $box['btn_text'] ); ?>">
				<span class="tmb-btn-ico tmb-btn-open"><?php echo TMB_Icons::svg( $box['btn_icon'], 'tmb-ico' ); // phpcs:ignore ?></span>
				<span class="tmb-btn-ico tmb-btn-x">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
				</span>
				<?php if ( ! empty( $box['btn_show_text'] ) && ! empty( $box['btn_text'] ) ) : ?>
					<span class="tmb-btn-text"><?php echo esc_html( $box['btn_text'] ); ?></span>
				<?php endif; ?>
			</button>
		</div>
		<?php
		return ob_get_clean();
	}

	/**
	 * Print all visible boxes in the footer.
	 */
	public function render() {
		foreach ( $this->active_boxes() as $box ) {
			echo $this->box_markup( $box ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
		}
	}

	/**
	 * Find a box by id, falling back to the first one.
	 *
	 * @param string $id Box id.
	 * @return array|null
	 */
	protected function find_box( $id = '' ) {
		if ( empty( $this->s['boxes'] ) ) {
			return null;
		}
		if ( $id ) {
			foreach ( $this->s['boxes'] as $box ) {
				if ( $box['id'] === $id ) {
					return $box;
				}
			}
		}
		return $this->s['boxes'][0];
	}

	/**
	 * Shortcode: inline static box.
	 *
	 * @param array $atts Attributes.
	 * @return string
	 */
	public function shortcode_box( $atts ) {
		$atts = shortcode_atts(
			array(
				'id'       => '',
				'title'    => null,
				'subtitle' => null,
			),
			$atts,
			'tamas_box'
		);

		$box = $this->find_box( sanitize_key( $atts['id'] ) );
		if ( ! $box ) {
			return '';
		}

		wp_enqueue_style( 'tmb-frontend', TMB_URL . 'assets/css/frontend.css', array(), TMB_VERSION );
		wp_add_inline_style( 'tmb-frontend', $this->inline_css() . $this->box_vars( $box, '.tmb-inline-' . $box['id'] ) );

		$title    = ( null === $atts['title'] ) ? $box['panel_title'] : $atts['title'];
		$subtitle = ( null === $atts['subtitle'] ) ? $box['panel_subtitle'] : $atts['subtitle'];

		$items = '';
		foreach ( $box['items'] as $item ) {
			$items .= $this->item_html( $item, $box );
		}

		$dir = 'auto' === $this->s['direction'] ? ( is_rtl() ? 'rtl' : 'ltr' ) : $this->s['direction'];

		$html  = '<div class="tmb-root tmb-inline tmb-inline-' . esc_attr( $box['id'] ) . ' tmb-style-' . esc_attr( $box['item_style'] ) . '" dir="' . esc_attr( $dir ) . '">';
		$html .= '<div class="tmb-panel tmb-panel-static">';
		if ( $title || $subtitle ) {
			$html .= '<div class="tmb-head"><div class="tmb-head-texts">';
			$html .= '<strong class="tmb-head-title">' . esc_html( $title ) . '</strong>';
			if ( $subtitle ) {
				$html .= '<span class="tmb-head-sub">' . esc_html( $subtitle ) . '</span>';
			}
			$html .= '</div></div>';
		}
		$html .= '<div class="tmb-items">' . $items . '</div>';
		$html .= '</div></div>';

		return $html;
	}

	/**
	 * CSS variables for an arbitrary selector (used by the shortcode).
	 *
	 * @param array  $box      Box.
	 * @param string $selector CSS selector.
	 * @return string
	 */
	protected function box_vars( $box, $selector ) {
		$css  = $selector . '{';
		$css .= '--tmb-btn-1:' . $box['btn_color_1'] . ';';
		$css .= '--tmb-btn-2:' . ( $box['btn_color_2'] ? $box['btn_color_2'] : $box['btn_color_1'] ) . ';';
		$css .= '--tmb-btn-fg:' . $box['btn_icon_color'] . ';';
		$css .= '--tmb-panel-bg:' . $box['panel_bg'] . ';';
		$css .= '--tmb-panel-text:' . $box['panel_text'] . ';';
		$css .= '--tmb-panel-sub:' . $box['panel_sub_text'] . ';';
		$css .= '--tmb-head-bg:' . $box['panel_head_bg'] . ';';
		$css .= '--tmb-head-text:' . $box['panel_head_text'] . ';';
		$css .= '--tmb-panel-radius:' . intval( $box['panel_radius'] ) . 'px;';
		$css .= '--tmb-item-bg:' . $box['item_bg'] . ';';
		$css .= '--tmb-item-hover:' . $box['item_hover_bg'] . ';';
		$css .= '--tmb-item-divider:' . $box['item_divider'] . ';';
		$css .= '--tmb-item-text:' . $box['item_text'] . ';';
		$css .= '--tmb-item-sub:' . $box['item_sub_text'] . ';';
		$css .= '--tmb-icon-size:' . intval( $box['icon_size'] ) . 'px;';
		$css .= '}';

		return $css;
	}

	/**
	 * Shortcode: a button that opens a floating box.
	 *
	 * @param array $atts Attributes.
	 * @return string
	 */
	public function shortcode_button( $atts ) {
		$atts = shortcode_atts(
			array(
				'id'   => '',
				'text' => '',
			),
			$atts,
			'tamas_button'
		);

		$box = $this->find_box( sanitize_key( $atts['id'] ) );
		if ( ! $box ) {
			return '';
		}

		$text = $atts['text'] ? $atts['text'] : $box['btn_text'];

		return '<button type="button" class="tmb-inline-btn" data-tmb-open="' . esc_attr( $box['id'] ) . '">'
			. TMB_Icons::svg( $box['btn_icon'], 'tmb-ico' )
			. '<span>' . esc_html( $text ) . '</span></button>';
	}
}
