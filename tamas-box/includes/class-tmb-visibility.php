<?php
/**
 * Page/display visibility engine.
 *
 * Decides whether the contact button should be shown on the current request,
 * based on page types, specific pages, post types, taxonomies, URL rules,
 * devices, user roles and schedule.
 *
 * @package Tamas_Box
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class TMB_Visibility {

	/**
	 * Evaluate all visibility rules for a single box.
	 *
	 * @param array $box    Box settings.
	 * @param array $global Global settings.
	 * @return bool
	 */
	public static function is_box_visible( $box, $global = array() ) {

		// 1) Box switch.
		if ( empty( $box['enabled'] ) ) {
			return false;
		}

		// 2) Devices (at least one must be on; per-device CSS handles the rest).
		if ( empty( $box['show_desktop'] ) && empty( $box['show_mobile'] ) ) {
			return false;
		}

		// 3) User roles / login state.
		if ( ! self::check_users( $box ) ) {
			return false;
		}

		// 4) Schedule.
		if ( ! self::check_schedule( $box ) ) {
			return false;
		}

		// 5) URL keyword rules.
		$url_rule = self::check_url_rules( $box );
		if ( 'exclude' === $url_rule ) {
			return false;
		}
		if ( 'include' === $url_rule ) {
			return apply_filters( 'tmb_box_should_render', true, $box, $global );
		}

		// 6) Page rules.
		$visible = self::check_pages( $box );

		/**
		 * Final say for developers, per box.
		 *
		 * @param bool  $visible
		 * @param array $box
		 * @param array $global
		 */
		return (bool) apply_filters( 'tmb_box_should_render', $visible, $box, $global );
	}

	/**
	 * Global gate: is the plugin allowed to output anything at all?
	 *
	 * @param array $s Global settings.
	 * @return bool
	 */
	public static function is_active( $s ) {
		if ( empty( $s['enabled'] ) ) {
			return false;
		}
		if ( is_admin() || is_feed() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) ) {
			return false;
		}
		return (bool) apply_filters( 'tmb_should_render', true, $s );
	}

	/**
	 * Login state + role rules.
	 *
	 * @param array $s Settings.
	 * @return bool
	 */
	protected static function check_users( $s ) {
		$mode = isset( $s['user_mode'] ) ? $s['user_mode'] : 'all';

		if ( 'logged_in' === $mode && ! is_user_logged_in() ) {
			return false;
		}
		if ( 'logged_out' === $mode && is_user_logged_in() ) {
			return false;
		}

		if ( 'roles' === $mode ) {
			if ( ! is_user_logged_in() ) {
				return false;
			}
			$allowed = isset( $s['user_roles'] ) && is_array( $s['user_roles'] ) ? $s['user_roles'] : array();
			if ( empty( $allowed ) ) {
				return true;
			}
			$user = wp_get_current_user();
			if ( ! $user || empty( $user->roles ) ) {
				return false;
			}
			if ( ! array_intersect( (array) $user->roles, $allowed ) ) {
				return false;
			}
		}

		return true;
	}

	/**
	 * Weekly schedule with support for multiple time ranges.
	 *
	 * A box is visible when it matches the main range OR any extra range.
	 * An empty from/to means "all day" for that range.
	 *
	 * @param array $s Box settings.
	 * @return bool
	 */
	protected static function check_schedule( $s ) {
		if ( empty( $s['schedule_enabled'] ) ) {
			return true;
		}

		$today = strtolower( current_time( 'D' ) ); // sat, sun, mon...
		$now   = (int) current_time( 'Hi' );

		$ranges = array();

		// Main range.
		$ranges[] = array(
			'days' => isset( $s['schedule_days'] ) && is_array( $s['schedule_days'] ) ? $s['schedule_days'] : array(),
			'from' => isset( $s['schedule_from'] ) ? $s['schedule_from'] : '',
			'to'   => isset( $s['schedule_to'] ) ? $s['schedule_to'] : '',
		);

		// Extra ranges.
		if ( ! empty( $s['schedule_ranges'] ) && is_array( $s['schedule_ranges'] ) ) {
			foreach ( $s['schedule_ranges'] as $range ) {
				if ( is_array( $range ) ) {
					$ranges[] = array(
						'days' => isset( $range['days'] ) && is_array( $range['days'] ) ? $range['days'] : array(),
						'from' => isset( $range['from'] ) ? $range['from'] : '',
						'to'   => isset( $range['to'] ) ? $range['to'] : '',
					);
				}
			}
		}

		foreach ( $ranges as $range ) {
			if ( self::range_matches( $range, $today, $now ) ) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Does one schedule range match right now?
	 *
	 * Public because the live chat module reuses it for its business hours.
	 *
	 * @param array  $range Range with days/from/to.
	 * @param string $today Lowercase 3 letter day.
	 * @param int    $now   Current time as Hi integer.
	 * @return bool
	 */
	public static function range_matches( $range, $today, $now ) {
		$days = isset( $range['days'] ) ? (array) $range['days'] : array();
		$from = isset( $range['from'] ) ? trim( (string) $range['from'] ) : '';
		$to   = isset( $range['to'] ) ? trim( (string) $range['to'] ) : '';

		// A completely empty range is not a rule at all.
		if ( empty( $days ) && '' === $from && '' === $to ) {
			return false;
		}

		// Day check (empty = every day).
		if ( ! empty( $days ) && ! in_array( $today, $days, true ) ) {
			return false;
		}

		// Time check (empty = all day).
		if ( '' === $from || '' === $to ) {
			return true;
		}

		$from_int = (int) str_replace( ':', '', $from );
		$to_int   = (int) str_replace( ':', '', $to );

		if ( $from_int === $to_int ) {
			return true;
		}

		// Overnight range, e.g. 22:00 -> 06:00.
		if ( $from_int > $to_int ) {
			return ( $now >= $from_int || $now <= $to_int );
		}

		return ( $now >= $from_int && $now <= $to_int );
	}

	/**
	 * URL keyword rules.
	 *
	 * @param array $s Settings.
	 * @return string '' | 'include' | 'exclude'
	 */
	protected static function check_url_rules( $s ) {
		$current = isset( $_SERVER['REQUEST_URI'] ) ? esc_url_raw( wp_unslash( $_SERVER['REQUEST_URI'] ) ) : '';
		if ( '' === $current ) {
			return '';
		}
		$current = strtolower( $current );

		$hide = self::lines( isset( $s['url_hide'] ) ? $s['url_hide'] : '' );
		foreach ( $hide as $needle ) {
			if ( self::url_match( $current, $needle ) ) {
				return 'exclude';
			}
		}

		$show = self::lines( isset( $s['url_show'] ) ? $s['url_show'] : '' );
		foreach ( $show as $needle ) {
			if ( self::url_match( $current, $needle ) ) {
				return 'include';
			}
		}

		return '';
	}

	/**
	 * Match a URL against a keyword pattern (supports * wildcard).
	 *
	 * @param string $url     Current URL (lowercase).
	 * @param string $pattern Pattern.
	 * @return bool
	 */
	protected static function url_match( $url, $pattern ) {
		$pattern = strtolower( trim( $pattern ) );
		if ( '' === $pattern ) {
			return false;
		}

		if ( false !== strpos( $pattern, '*' ) ) {
			$regex = '#' . str_replace( '\*', '.*', preg_quote( $pattern, '#' ) ) . '#';
			return (bool) preg_match( $regex, $url );
		}

		return ( false !== strpos( $url, $pattern ) );
	}

	/**
	 * Split a textarea into trimmed lines.
	 *
	 * @param string $text Raw text.
	 * @return array
	 */
	protected static function lines( $text ) {
		$parts = preg_split( '/[\r\n,]+/', (string) $text );
		$out   = array();
		foreach ( (array) $parts as $p ) {
			$p = trim( $p );
			if ( '' !== $p ) {
				$out[] = $p;
			}
		}
		return $out;
	}

	/**
	 * Main page rules: whitelist / blacklist / everywhere.
	 *
	 * @param array $s Settings.
	 * @return bool
	 */
	protected static function check_pages( $s ) {
		$mode = isset( $s['display_mode'] ) ? $s['display_mode'] : 'all';

		if ( 'all' === $mode ) {
			// Everywhere, minus the "hide on" selections.
			return ! self::matches( $s, 'hide' );
		}

		if ( 'only' === $mode ) {
			// Only where selected, and never where explicitly hidden.
			if ( self::matches( $s, 'hide' ) ) {
				return false;
			}
			return self::matches( $s, 'show' );
		}

		return true;
	}

	/**
	 * Does the current request match the given rule group?
	 *
	 * @param array  $s     Settings.
	 * @param string $group 'show' or 'hide'.
	 * @return bool
	 */
	protected static function matches( $s, $group ) {
		$types = isset( $s[ $group . '_types' ] ) && is_array( $s[ $group . '_types' ] ) ? $s[ $group . '_types' ] : array();
		$ids   = self::ids( isset( $s[ $group . '_ids' ] ) ? $s[ $group . '_ids' ] : '' );
		$pts   = isset( $s[ $group . '_post_types' ] ) && is_array( $s[ $group . '_post_types' ] ) ? $s[ $group . '_post_types' ] : array();
		$terms = self::ids( isset( $s[ $group . '_terms' ] ) ? $s[ $group . '_terms' ] : '' );

		if ( empty( $types ) && empty( $ids ) && empty( $pts ) && empty( $terms ) ) {
			return false;
		}

		// --- Page types ---
		foreach ( $types as $type ) {
			if ( self::is_page_type( $type ) ) {
				return true;
			}
		}

		// --- Specific IDs ---
		if ( ! empty( $ids ) ) {
			$current_id = self::current_id();
			if ( $current_id && in_array( $current_id, $ids, true ) ) {
				return true;
			}
		}

		// --- Post types ---
		if ( ! empty( $pts ) ) {
			if ( is_singular( $pts ) ) {
				return true;
			}
			foreach ( $pts as $pt ) {
				if ( is_post_type_archive( $pt ) ) {
					return true;
				}
			}
		}

		// --- Taxonomy terms ---
		if ( ! empty( $terms ) ) {
			if ( is_category( $terms ) || is_tag( $terms ) ) {
				return true;
			}
			if ( is_tax() ) {
				$obj = get_queried_object();
				if ( $obj && isset( $obj->term_id ) && in_array( (int) $obj->term_id, $terms, true ) ) {
					return true;
				}
			}
			if ( is_singular() ) {
				$post_id = get_the_ID();
				if ( $post_id ) {
					$taxes = get_object_taxonomies( get_post_type( $post_id ) );
					foreach ( (array) $taxes as $tax ) {
						if ( has_term( $terms, $tax, $post_id ) ) {
							return true;
						}
					}
				}
			}
		}

		return false;
	}

	/**
	 * Test a named page type against the current request.
	 *
	 * @param string $type Type key.
	 * @return bool
	 */
	protected static function is_page_type( $type ) {
		switch ( $type ) {
			case 'front':
				return is_front_page();
			case 'blog':
				return is_home();
			case 'singular':
				return is_singular();
			case 'post':
				return is_singular( 'post' );
			case 'page':
				return is_page();
			case 'archive':
				return is_archive();
			case 'category':
				return is_category();
			case 'tag':
				return is_tag();
			case 'author':
				return is_author();
			case 'date':
				return is_date();
			case 'search':
				return is_search();
			case 'notfound':
				return is_404();
			case 'attachment':
				return is_attachment();

			/* WooCommerce */
			case 'shop':
				return function_exists( 'is_shop' ) && is_shop();
			case 'product':
				return function_exists( 'is_product' ) && is_product();
			case 'product_cat':
				return function_exists( 'is_product_category' ) && is_product_category();
			case 'cart':
				return function_exists( 'is_cart' ) && is_cart();
			case 'checkout':
				return function_exists( 'is_checkout' ) && is_checkout();
			case 'account':
				return function_exists( 'is_account_page' ) && is_account_page();
		}

		return false;
	}

	/**
	 * Current object ID (post, page, term, author...).
	 *
	 * @return int
	 */
	protected static function current_id() {
		if ( is_singular() ) {
			return (int) get_the_ID();
		}
		$id = get_queried_object_id();
		return $id ? (int) $id : 0;
	}

	/**
	 * Parse a comma/newline list of IDs.
	 *
	 * @param mixed $value Raw value.
	 * @return array
	 */
	protected static function ids( $value ) {
		if ( is_array( $value ) ) {
			$parts = $value;
		} else {
			$parts = preg_split( '/[\s,;،]+/', (string) $value );
		}

		$out = array();
		foreach ( (array) $parts as $p ) {
			$p = absint( $p );
			if ( $p ) {
				$out[] = $p;
			}
		}
		return array_values( array_unique( $out ) );
	}

	/**
	 * Page type labels for the admin UI.
	 *
	 * @return array
	 */
	public static function page_types() {
		$types = array(
			'front'      => __( 'صفحه اصلی سایت', 'tamas-box' ),
			'blog'       => __( 'صفحه بلاگ (آخرین نوشته‌ها)', 'tamas-box' ),
			'page'       => __( 'همه برگه‌ها', 'tamas-box' ),
			'post'       => __( 'همه نوشته‌ها', 'tamas-box' ),
			'singular'   => __( 'همه صفحات تکی', 'tamas-box' ),
			'archive'    => __( 'همه آرشیوها', 'tamas-box' ),
			'category'   => __( 'آرشیو دسته‌ها', 'tamas-box' ),
			'tag'        => __( 'آرشیو برچسب‌ها', 'tamas-box' ),
			'author'     => __( 'آرشیو نویسنده', 'tamas-box' ),
			'date'       => __( 'آرشیو تاریخ', 'tamas-box' ),
			'search'     => __( 'صفحه نتایج جستجو', 'tamas-box' ),
			'notfound'   => __( 'صفحه ۴۰۴', 'tamas-box' ),
			'attachment' => __( 'صفحه پیوست', 'tamas-box' ),
		);

		if ( class_exists( 'WooCommerce' ) ) {
			$types['shop']        = __( 'فروشگاه (ووکامرس)', 'tamas-box' );
			$types['product']     = __( 'صفحه محصول (ووکامرس)', 'tamas-box' );
			$types['product_cat'] = __( 'دسته محصولات (ووکامرس)', 'tamas-box' );
			$types['cart']        = __( 'سبد خرید (ووکامرس)', 'tamas-box' );
			$types['checkout']    = __( 'تسویه حساب (ووکامرس)', 'tamas-box' );
			$types['account']     = __( 'حساب کاربری (ووکامرس)', 'tamas-box' );
		}

		return apply_filters( 'tmb_page_types', $types );
	}

	/**
	 * Public post types for the admin UI.
	 *
	 * @return array
	 */
	public static function post_types() {
		$out  = array();
		$list = get_post_types( array( 'public' => true ), 'objects' );

		foreach ( (array) $list as $pt ) {
			if ( in_array( $pt->name, array( 'attachment' ), true ) ) {
				continue;
			}
			$out[ $pt->name ] = $pt->labels->singular_name ? $pt->labels->singular_name : $pt->name;
		}

		return $out;
	}

	/**
	 * Weekday labels.
	 *
	 * @return array
	 */
	public static function days() {
		return array(
			'sat' => __( 'شنبه', 'tamas-box' ),
			'sun' => __( 'یکشنبه', 'tamas-box' ),
			'mon' => __( 'دوشنبه', 'tamas-box' ),
			'tue' => __( 'سه‌شنبه', 'tamas-box' ),
			'wed' => __( 'چهارشنبه', 'tamas-box' ),
			'thu' => __( 'پنجشنبه', 'tamas-box' ),
			'fri' => __( 'جمعه', 'tamas-box' ),
		);
	}
}
